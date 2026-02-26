/**
 * WiFi Information Service
 *
 * Retrieves connection details from NetworkManager and `iw` command.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import NM from 'gi://NM';

import { parseIwLinkOutput, parseIwScanDump, createEmptyIwLinkInfo, WIFI_GENERATIONS } from './wifiGeneration.js';
import {
    type WifiConnectionInfo,
    type ConnectedInfo,
    type DisconnectedInfo,
    type ScannedNetwork,
    type FrequencyMHz,
    type FrequencyBand,
    type ChannelNumber,
    type SignalDbm,
    type SignalQuality,
    type SecurityProtocol,
    type SignalCssClass,
    type ChannelWidthMHz,
    type WifiGeneration,
    SIGNAL_THRESHOLDS,
    createDisconnectedInfo,
    isConnected,
    asFrequencyMHz,
    asSignalDbm,
    asSignalPercent,
    asBitrateMbps,
    asChannelNumber,
    asChannelWidthMHz,
} from './types.js';

export {
    type WifiConnectionInfo,
    type ConnectedInfo,
    type DisconnectedInfo,
    type ScannedNetwork,
    type SignalQuality,
    isConnected,
};

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
Gio._promisify(NM.DeviceWifi.prototype, 'request_scan_async', 'request_scan_finish');

const PLACEHOLDER = '--' as const;

export class WifiInfoService {
    private client: NM.Client | null = null;
    private initPromise: Promise<void> | null = null;
    private watchedDevice: NM.DeviceWifi | null = null;
    private deviceSignalIds: number[] = [];
    private generationMap = new Map<string, WifiGeneration>();

    async init(): Promise<void> {
        if (this.client) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            NM.Client.new_async(null, (_obj, result) => {
                try {
                    this.client = NM.Client.new_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });

        return this.initPromise;
    }

    destroy(): void {
        this.unwatchDeviceSignals();
        this.client = null;
        this.initPromise = null;
        this.generationMap.clear();
    }

    watchDeviceSignals(callback: () => void): void {
        this.unwatchDeviceSignals();

        const device = this.findWifiDevice();
        if (!device) return;

        this.watchedDevice = device;
        this.deviceSignalIds = [
            device.connect('state-changed', () => callback()),
            device.connect('notify::active-access-point', () => callback()),
            device.connect('notify::last-scan', () => this.onScanCompleted()),
        ];
    }

    unwatchDeviceSignals(): void {
        if (this.watchedDevice) {
            for (const id of this.deviceSignalIds) {
                GObject.signal_handler_disconnect(this.watchedDevice, id);
            }
        }
        this.watchedDevice = null;
        this.deviceSignalIds = [];
    }

    async getConnectionInfo(): Promise<WifiConnectionInfo> {
        if (!this.client) {
            return createDisconnectedInfo();
        }

        const wifiDevice = this.findWifiDevice();
        if (!wifiDevice) {
            return createDisconnectedInfo();
        }

        const interfaceName = wifiDevice.get_iface();

        if (wifiDevice.get_state() !== NM.DeviceState.ACTIVATED) {
            return createDisconnectedInfo(interfaceName);
        }

        const activeAp = wifiDevice.get_active_access_point();

        if (!activeAp) {
            return createDisconnectedInfo(interfaceName);
        }

        return this.buildConnectedInfo(wifiDevice, activeAp, interfaceName);
    }

    requestScan(): void {
        const device = this.findWifiDevice();
        if (!device) return;

        device.request_scan_async(null).catch(() => {
            // Rate-limited or permission denied - use cached results
        });
    }

    async getAvailableNetworks(excludeSsid?: string): Promise<Map<string, ScannedNetwork[]>> {
        if (!this.client) return new Map();

        const wifiDevice = this.findWifiDevice();
        if (!wifiDevice) return new Map();

        const accessPoints = wifiDevice.get_access_points();
        const lastScanSec = wifiDevice.get_last_scan() / 1000;

        const networks: ScannedNetwork[] = [];

        for (const ap of accessPoints) {
            if (isStaleAccessPoint(ap, lastScanSec)) continue;

            const ssid = this.decodeSsid(ap.get_ssid());
            if (!ssid) continue;
            if (excludeSsid && ssid === excludeSsid) continue;

            const bssid = (ap.get_bssid() ?? '').toLowerCase();
            if (!bssid) continue;

            const frequency = asFrequencyMHz(ap.get_frequency());
            const generation = this.generationMap.get(bssid) ?? WIFI_GENERATIONS.UNKNOWN;

            networks.push(Object.freeze({
                ssid,
                bssid,
                frequency,
                channel: frequencyToChannel(frequency),
                band: frequencyToBand(frequency),
                bandwidth: getApBandwidth(ap),
                maxBitrate: asBitrateMbps(ap.get_max_bitrate() / 1000),
                signalPercent: asSignalPercent(ap.get_strength()),
                security: getSecurityProtocol(ap),
                generation,
            }));
        }

        return groupBySSID(sortBySignalStrength(networks));
    }

    private findWifiDevice(): NM.DeviceWifi | null {
        if (!this.client) return null;

        const devices = this.client.get_devices();

        for (const device of devices) {
            if (device instanceof NM.DeviceWifi && device.get_state() === NM.DeviceState.ACTIVATED) {
                return device;
            }
        }

        for (const device of devices) {
            if (device instanceof NM.DeviceWifi) {
                return device;
            }
        }

        return null;
    }

    private onScanCompleted(): void {
        const device = this.findWifiDevice();
        if (!device) return;

        const interfaceName = device.get_iface();
        if (!interfaceName) return;

        this.executeIwScanDump(interfaceName);
    }

    private async executeIwScanDump(interfaceName: string): Promise<void> {
        try {
            const proc = Gio.Subprocess.new(
                ['iw', 'dev', interfaceName, 'scan', 'dump'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );
            const [stdout] = await proc.communicate_utf8_async(null, null);
            if (proc.get_successful() && stdout) {
                const freshMap = parseIwScanDump(stdout);
                if (freshMap.size > 0) {
                    this.generationMap = freshMap;
                }
            }
        } catch {
            // iw scan dump not available or insufficient permissions - graceful degradation
        }
    }

    private async buildConnectedInfo(
        device: NM.DeviceWifi,
        ap: NM.AccessPoint,
        interfaceName: string | null
    ): Promise<ConnectedInfo> {
        const iwInfo = await this.executeIwLink(interfaceName);
        const frequency = asFrequencyMHz(ap.get_frequency());
        const strengthPercent = ap.get_strength();

        return Object.freeze({
            connected: true as const,
            interfaceName,
            ssid: this.decodeSsid(ap.get_ssid()) ?? 'Unknown',
            bssid: ap.get_bssid() ?? 'Unknown',
            frequency,
            channel: frequencyToChannel(frequency),
            band: frequencyToBand(frequency),
            signalStrength: iwInfo.signal ?? estimateSignalDbm(strengthPercent),
            signalPercent: asSignalPercent(strengthPercent),
            bitrate: asBitrateMbps(device.get_bitrate() / 1000),
            security: getSecurityProtocol(ap),
            generation: iwInfo.generation,
            standard: iwInfo.standard,
            mcs: iwInfo.mcs,
            nss: iwInfo.nss,
            guardInterval: iwInfo.guardInterval,
            channelWidth: iwInfo.channelWidth,
            txBitrate: iwInfo.txBitrate,
            rxBitrate: iwInfo.rxBitrate,
        });
    }

    private async executeIwLink(interfaceName: string | null) {
        if (!interfaceName) {
            return createEmptyIwLinkInfo();
        }

        try {
            const proc = Gio.Subprocess.new(
                ['iw', 'dev', interfaceName, 'link'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            );
            const [stdout] = await proc.communicate_utf8_async(null, null);
            if (proc.get_successful() && stdout) {
                return parseIwLinkOutput(stdout);
            }
        } catch {
            // iw not available - graceful degradation
        }

        return createEmptyIwLinkInfo();
    }

    private decodeSsid(ssidBytes: GLib.Bytes | null): string | null {
        if (!ssidBytes) return null;
        const data = ssidBytes.get_data();
        return data ? new TextDecoder().decode(data) : null;
    }
}

function estimateSignalDbm(strengthPercent: number): SignalDbm {
    const MIN_DBM = -90;
    const MAX_DBM = -30;
    return asSignalDbm(MIN_DBM + (strengthPercent / 100) * (MAX_DBM - MIN_DBM));
}

function frequencyToChannel(frequency: FrequencyMHz): ChannelNumber {
    const freq = frequency as number;

    if (freq >= 2412 && freq <= 2484) {
        if (freq === 2484) return asChannelNumber(14);
        return asChannelNumber(Math.round((freq - 2412) / 5) + 1);
    }

    if (freq >= 5170 && freq <= 5825) {
        return asChannelNumber(Math.round((freq - 5000) / 5));
    }

    if (freq >= 5955 && freq <= 7115) {
        return asChannelNumber(Math.round((freq - 5950) / 5));
    }

    return asChannelNumber(0);
}

function frequencyToBand(frequency: FrequencyMHz): FrequencyBand {
    const freq = frequency as number;

    if (freq >= 2400 && freq < 2500) return '2.4 GHz';
    if (freq >= 5150 && freq < 5900) return '5 GHz';
    if (freq >= 5925 && freq <= 7125) return '6 GHz';
    return 'Unknown';
}

const AP_SECURITY = {
    NONE: 0x0,
    KEY_MGMT_PSK: 0x100,
    KEY_MGMT_802_1X: 0x200,
    KEY_MGMT_SAE: 0x400,
} as const;

function getSecurityProtocol(ap: NM.AccessPoint): SecurityProtocol {
    const wpaFlags = ap.get_wpa_flags();
    const rsnFlags = ap.get_rsn_flags();

    const protocols = detectSecurityProtocols(wpaFlags, rsnFlags);

    if (protocols.length === 0) {
        const isOpen = wpaFlags === AP_SECURITY.NONE && rsnFlags === AP_SECURITY.NONE;
        return isOpen ? 'Open' : 'Unknown';
    }

    return protocols[0];
}

function detectSecurityProtocols(wpaFlags: number, rsnFlags: number): SecurityProtocol[] {
    const protocols: SecurityProtocol[] = [];

    if (rsnFlags & AP_SECURITY.KEY_MGMT_SAE) {
        protocols.push('WPA3');
    }

    if (rsnFlags & AP_SECURITY.KEY_MGMT_802_1X) {
        protocols.push('WPA2-Enterprise');
    } else if (rsnFlags & AP_SECURITY.KEY_MGMT_PSK) {
        protocols.push('WPA2');
    }

    if (wpaFlags & AP_SECURITY.KEY_MGMT_802_1X && !protocols.includes('WPA2-Enterprise')) {
        protocols.push('WPA-Enterprise');
    } else if (wpaFlags & AP_SECURITY.KEY_MGMT_PSK) {
        protocols.push('WPA');
    }

    return protocols;
}

export function getSignalQuality(signalStrength: SignalDbm | null): SignalQuality {
    if (signalStrength === null) return 'Unknown';

    const dbm = signalStrength as number;
    if (dbm >= SIGNAL_THRESHOLDS.Excellent) return 'Excellent';
    if (dbm >= SIGNAL_THRESHOLDS.Good) return 'Good';
    if (dbm >= SIGNAL_THRESHOLDS.Fair) return 'Fair';
    if (dbm >= SIGNAL_THRESHOLDS.Weak) return 'Weak';
    return 'Poor';
}

export function getSignalCssClass(signalStrength: SignalDbm | null): SignalCssClass {
    const quality = getSignalQuality(signalStrength);

    const cssClassMap: Record<SignalQuality, SignalCssClass> = {
        Excellent: 'wifi-signal-excellent',
        Good: 'wifi-signal-good',
        Fair: 'wifi-signal-fair',
        Weak: 'wifi-signal-weak',
        Poor: 'wifi-signal-poor',
        Unknown: '',
    };

    return cssClassMap[quality];
}

export function formatValue<T>(value: T | null, formatter?: (v: T) => string): string {
    if (value === null) return PLACEHOLDER;
    return formatter ? formatter(value) : String(value);
}

export function sortBySignalStrength(networks: ScannedNetwork[]): ScannedNetwork[] {
    return [...networks].sort(
        (a, b) => (b.signalPercent as number) - (a.signalPercent as number),
    );
}

export function groupBySSID(networks: ScannedNetwork[]): Map<string, ScannedNetwork[]> {
    const groups = new Map<string, ScannedNetwork[]>();

    for (const network of networks) {
        const existing = groups.get(network.ssid);
        if (existing) {
            existing.push(network);
        } else {
            groups.set(network.ssid, [network]);
        }
    }

    return groups;
}

const STALE_AP_TOLERANCE_SECONDS = 10;

function isStaleAccessPoint(ap: NM.AccessPoint, lastScanSec: number): boolean {
    if (lastScanSec <= 0) return false;

    const lastSeen = ap.get_last_seen();
    if (lastSeen === -1) return true;

    return lastSeen < lastScanSec - STALE_AP_TOLERANCE_SECONDS;
}

const DEFAULT_BANDWIDTH_MHZ = 20;

function getApBandwidth(ap: NM.AccessPoint): ChannelWidthMHz {
    const bandwidth = (ap as unknown as { get_bandwidth?: () => number }).get_bandwidth?.();
    return asChannelWidthMHz(bandwidth && bandwidth > 0 ? bandwidth : DEFAULT_BANDWIDTH_MHZ);
}
