/**
 * Core type definitions for WiFi Signal Plus
 */

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type FrequencyMHz = Brand<number, 'FrequencyMHz'>;
export type SignalDbm = Brand<number, 'SignalDbm'>;
export type SignalPercent = Brand<number, 'SignalPercent'>;
export type BitrateMbps = Brand<number, 'BitrateMbps'>;
export type ChannelWidthMHz = Brand<number, 'ChannelWidthMHz'>;
export type ChannelNumber = Brand<number, 'ChannelNumber'>;
export type McsIndex = Brand<number, 'McsIndex'>;
export type SpatialStreams = Brand<number, 'SpatialStreams'>;
export type GuardIntervalUs = Brand<number, 'GuardIntervalUs'>;

export const WIFI_GENERATIONS = {
    UNKNOWN: 0,
    WIFI_1: 1,
    WIFI_2: 2,
    WIFI_3: 3,
    WIFI_4: 4,
    WIFI_5: 5,
    WIFI_6: 6,
    WIFI_7: 7,
} as const;

export type WifiGeneration = (typeof WIFI_GENERATIONS)[keyof typeof WIFI_GENERATIONS];

export function isKnownGeneration(gen: WifiGeneration): gen is 1 | 2 | 3 | 4 | 5 | 6 | 7 {
    return gen >= WIFI_GENERATIONS.WIFI_1 && gen <= WIFI_GENERATIONS.WIFI_7;
}

export const IEEE_STANDARDS = {
    [WIFI_GENERATIONS.WIFI_1]: '802.11b',
    [WIFI_GENERATIONS.WIFI_2]: '802.11a',
    [WIFI_GENERATIONS.WIFI_3]: '802.11g',
    [WIFI_GENERATIONS.WIFI_4]: '802.11n',
    [WIFI_GENERATIONS.WIFI_5]: '802.11ac',
    [WIFI_GENERATIONS.WIFI_6]: '802.11ax',
    [WIFI_GENERATIONS.WIFI_7]: '802.11be',
    [WIFI_GENERATIONS.UNKNOWN]: 'Unknown',
} as const;

export type IeeeStandard = (typeof IEEE_STANDARDS)[WifiGeneration];

export const FREQUENCY_BANDS = ['2.4 GHz', '5 GHz', '6 GHz', 'Unknown'] as const;
export type FrequencyBand = (typeof FREQUENCY_BANDS)[number];

export const SIGNAL_QUALITIES = ['Excellent', 'Good', 'Fair', 'Weak', 'Poor', 'Unknown'] as const;
export type SignalQuality = (typeof SIGNAL_QUALITIES)[number];

export const SPEED_QUALITIES = ['Excellent', 'VeryGood', 'Good', 'OK', 'Weak', 'Poor'] as const;
export type SpeedQuality = (typeof SPEED_QUALITIES)[number];

export const SIGNAL_THRESHOLDS = {
    Excellent: -50,
    Good: -60,
    Fair: -70,
    Weak: -80,
} as const satisfies Record<Exclude<SignalQuality, 'Poor' | 'Unknown'>, number>;

export const SECURITY_PROTOCOLS = [
    'WPA3',
    'WPA2-Enterprise',
    'WPA2',
    'WPA-Enterprise',
    'WPA',
    'Open',
    'Unknown',
] as const;

export type SecurityProtocol = (typeof SECURITY_PROTOCOLS)[number];

export type GenerationCssClass = `wifi-gen-${1 | 2 | 3 | 4 | 5 | 6 | 7}` | 'wifi-disconnected';
export type SignalCssClass = `wifi-signal-${Lowercase<Exclude<SignalQuality, 'Unknown'>>}` | '';

export const GENERATION_CSS_CLASSES = {
    [WIFI_GENERATIONS.WIFI_1]: 'wifi-gen-1',
    [WIFI_GENERATIONS.WIFI_2]: 'wifi-gen-2',
    [WIFI_GENERATIONS.WIFI_3]: 'wifi-gen-3',
    [WIFI_GENERATIONS.WIFI_4]: 'wifi-gen-4',
    [WIFI_GENERATIONS.WIFI_5]: 'wifi-gen-5',
    [WIFI_GENERATIONS.WIFI_6]: 'wifi-gen-6',
    [WIFI_GENERATIONS.WIFI_7]: 'wifi-gen-7',
    [WIFI_GENERATIONS.UNKNOWN]: 'wifi-disconnected',
} as const satisfies Record<WifiGeneration, GenerationCssClass>;

export const GUARD_INTERVALS = {
    SHORT: 0.4 as GuardIntervalUs,
    NORMAL: 0.8 as GuardIntervalUs,
    LONG_1: 1.6 as GuardIntervalUs,
    LONG_2: 3.2 as GuardIntervalUs,
} as const;

export const HE_GI_INDEX_MAP = {
    0: GUARD_INTERVALS.NORMAL,
    1: GUARD_INTERVALS.LONG_1,
    2: GUARD_INTERVALS.LONG_2,
} as const satisfies Record<0 | 1 | 2, GuardIntervalUs>;

export interface IwLinkInfo {
    readonly generation: WifiGeneration;
    readonly standard: IeeeStandard | null;
    readonly mcs: McsIndex | null;
    readonly nss: SpatialStreams | null;
    readonly guardInterval: GuardIntervalUs | null;
    readonly channelWidth: ChannelWidthMHz | null;
    readonly txBitrate: BitrateMbps | null;
    readonly rxBitrate: BitrateMbps | null;
    readonly signal: SignalDbm | null;
    readonly frequency: FrequencyMHz | null;
    readonly ssid: string | null;
    readonly bssid: string | null;
}

interface BaseConnectionInfo {
    readonly interfaceName: string | null;
}

export interface DisconnectedInfo extends BaseConnectionInfo {
    readonly connected: false;
}

export interface ConnectedInfo extends BaseConnectionInfo {
    readonly connected: true;
    readonly ssid: string;
    readonly bssid: string;
    readonly frequency: FrequencyMHz;
    readonly channel: ChannelNumber;
    readonly band: FrequencyBand;
    readonly signalStrength: SignalDbm;
    readonly signalPercent: SignalPercent;
    readonly bitrate: BitrateMbps;
    readonly security: SecurityProtocol;
    readonly generation: WifiGeneration;
    readonly standard: IeeeStandard | null;
    readonly mcs: McsIndex | null;
    readonly nss: SpatialStreams | null;
    readonly guardInterval: GuardIntervalUs | null;
    readonly channelWidth: ChannelWidthMHz | null;
    readonly txBitrate: BitrateMbps | null;
    readonly rxBitrate: BitrateMbps | null;
    readonly maxBitrate: BitrateMbps;
}

export interface ScannedNetwork {
    readonly ssid: string;
    readonly bssid: string;
    readonly frequency: FrequencyMHz;
    readonly channel: ChannelNumber;
    readonly band: FrequencyBand;
    readonly bandwidth: ChannelWidthMHz;
    readonly maxBitrate: BitrateMbps;
    readonly signalPercent: SignalPercent;
    readonly security: SecurityProtocol;
    readonly generation: WifiGeneration;
}

export type WifiConnectionInfo = DisconnectedInfo | ConnectedInfo;

export function isConnected(info: WifiConnectionInfo): info is ConnectedInfo {
    return info.connected;
}

export const asFrequencyMHz = (value: number): FrequencyMHz => value as FrequencyMHz;
export const asSignalDbm = (value: number): SignalDbm => value as SignalDbm;
export const asSignalPercent = (value: number): SignalPercent => value as SignalPercent;
export const asBitrateMbps = (value: number): BitrateMbps => value as BitrateMbps;
export const asChannelWidthMHz = (value: number): ChannelWidthMHz => value as ChannelWidthMHz;
export const asChannelNumber = (value: number): ChannelNumber => value as ChannelNumber;
export const asMcsIndex = (value: number): McsIndex => value as McsIndex;
export const asSpatialStreams = (value: number): SpatialStreams => value as SpatialStreams;
export const asGuardIntervalUs = (value: number): GuardIntervalUs => value as GuardIntervalUs;

const SIGNAL_PERCENT_THRESHOLDS = {
    Excellent: 80,
    Good: 60,
    Fair: 40,
    Weak: 20,
} as const;

export function getSignalQualityFromPercent(signalPercent: SignalPercent): SignalQuality {
    const pct = signalPercent as number;
    if (pct >= SIGNAL_PERCENT_THRESHOLDS.Excellent) return 'Excellent';
    if (pct >= SIGNAL_PERCENT_THRESHOLDS.Good) return 'Good';
    if (pct >= SIGNAL_PERCENT_THRESHOLDS.Fair) return 'Fair';
    if (pct >= SIGNAL_PERCENT_THRESHOLDS.Weak) return 'Weak';
    return 'Poor';
}

const SPEED_THRESHOLDS = {
    Excellent: 1000,
    VeryGood: 300,
    Good: 100,
    OK: 50,
    Weak: 20,
} as const;

export function getSpeedQuality(bitrate: BitrateMbps): SpeedQuality {
    const mbps = bitrate as number;
    if (mbps >= SPEED_THRESHOLDS.Excellent) return 'Excellent';
    if (mbps >= SPEED_THRESHOLDS.VeryGood) return 'VeryGood';
    if (mbps >= SPEED_THRESHOLDS.Good) return 'Good';
    if (mbps >= SPEED_THRESHOLDS.OK) return 'OK';
    if (mbps >= SPEED_THRESHOLDS.Weak) return 'Weak';
    return 'Poor';
}

export function createEmptyIwLinkInfo(): IwLinkInfo {
    return Object.freeze({
        generation: WIFI_GENERATIONS.UNKNOWN,
        standard: null,
        mcs: null,
        nss: null,
        guardInterval: null,
        channelWidth: null,
        txBitrate: null,
        rxBitrate: null,
        signal: null,
        frequency: null,
        ssid: null,
        bssid: null,
    });
}

export function createDisconnectedInfo(interfaceName: string | null = null): DisconnectedInfo {
    return Object.freeze({
        connected: false as const,
        interfaceName,
    });
}
