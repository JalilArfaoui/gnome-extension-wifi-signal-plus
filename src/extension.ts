/**
 * WiFi Signal Plus - GNOME Shell Extension
 *
 * Displays WiFi generation (4/5/6/7) in the top bar with detailed info on hover.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    WifiInfoService,
    getSignalQuality,
    isConnected,
    type WifiConnectionInfo,
    type ConnectedInfo,
} from './wifiInfo.js';
import {
    WIFI_GENERATIONS,
    GENERATION_CSS_CLASSES,
    getGenerationLabel,
    getGenerationDescription,
    getGenerationIconFilename,
} from './wifiGeneration.js';
import type { GenerationCssClass, ChannelWidthMHz, SignalDbm } from './types.js';

const REFRESH_INTERVAL_SECONDS = 5;
const PLACEHOLDER = '--' as const;
// WiFi 7 theoretical max: 320 MHz, MCS 13 (4096-QAM 5/6), 4×4 MIMO, GI 0.8µs
const MAX_SPEED_MBPS = 5760;
const MAX_CHANNEL_WIDTH_MHZ = 320;
const MIN_SIGNAL_DBM = -90;
const MAX_SIGNAL_DBM = -30;
const SIGNAL_HISTORY_MAX = 60;

const SIGNAL_QUALITY_COLORS: Readonly<Record<string, [number, number, number]>> = {
    Excellent: [0.2, 0.82, 0.48],
    Good: [0.56, 0.94, 0.64],
    Fair: [0.96, 0.83, 0.18],
    Weak: [1.0, 0.47, 0.0],
    Poor: [0.88, 0.11, 0.14],
};

type MenuItemId =
    | 'ssid'
    | 'generation'
    | 'band'
    | 'bitrate'
    | 'channelWidth'
    | 'mcs'
    | 'signal'
    | 'security'
    | 'bssid';

interface MenuItemConfig {
    readonly id: MenuItemId;
    readonly label: string;
}

const MENU_STRUCTURE: readonly MenuItemConfig[][] = [
    // Section: Connection
    [
        { id: 'ssid', label: 'Network' },
        { id: 'generation', label: 'Generation' },
        { id: 'band', label: 'Band' },
    ],
    // Section: Performance
    [
        { id: 'bitrate', label: 'Speed' },
        { id: 'channelWidth', label: 'Width' },
        { id: 'mcs', label: 'Modulation' },
    ],
    // Section: Signal & Security
    [
        { id: 'signal', label: 'Signal' },
        { id: 'security', label: 'Security' },
        { id: 'bssid', label: 'BSSID' },
    ],
] as const;

const ITEMS_WITH_BAR: ReadonlySet<MenuItemId> = new Set(['bitrate', 'channelWidth']);

export default class WifiSignalPlusExtension extends Extension {
    private indicator: PanelMenu.Button | null = null;
    private icon: St.Icon | null = null;
    private label: St.Label | null = null;
    private wifiService: WifiInfoService | null = null;
    private refreshTimeout: number | null = null;
    private signalGraph: St.DrawingArea | null = null;
    private readonly signalHistory: number[] = [];
    private readonly menuItems = new Map<
        MenuItemId,
        { item: PopupMenu.PopupBaseMenuItem; label: St.Label; value: St.Label; barFill?: St.Widget }
    >();

    enable(): void {
        this.wifiService = new WifiInfoService();
        this.wifiService
            .init()
            .then(() => {
                if (!this.wifiService) return;
                this.createIndicator();
                this.refresh();
                this.startRefreshTimer();
            })
            .catch(e => {
                console.error('[WiFi Signal Plus] Failed to initialize:', e);
            });
    }

    disable(): void {
        this.stopRefreshTimer();
        this.indicator?.destroy();
        this.wifiService?.destroy();

        this.indicator = null;
        this.wifiService = null;
        this.icon = null;
        this.label = null;
        this.signalGraph = null;
        this.signalHistory.length = 0;
        this.menuItems.clear();
    }

    private createIndicator(): void {
        this.indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        this.indicator.add_style_class_name('wifi-signal-plus-indicator');

        this.icon = new St.Icon({
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.label = new St.Label({
            text: 'WiFi',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'wifi-signal-plus-label',
        });

        this.indicator.add_child(this.icon);
        this.indicator.add_child(this.label);
        this.buildMenu();

        Main.panel.addToStatusArea(this.uuid, this.indicator);
    }

    private buildMenu(): void {
        if (!this.indicator) return;

        const menu = this.indicator.menu as PopupMenu.PopupMenu;
        menu.box.add_style_class_name('wifi-signal-plus-popup');
        menu.connect('open-state-changed', (_menu, isOpen: boolean) => {
            if (isOpen) this.refresh();
            return undefined;
        });

        const sectionHeaders = ['', 'Performance', 'Signal'];

        const SIGNAL_SECTION_INDEX = 2;

        MENU_STRUCTURE.forEach((section, index) => {
            if (sectionHeaders[index]) {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(sectionHeaders[index]));
            }

            if (index === SIGNAL_SECTION_INDEX) {
                this.addSignalGraph(menu);
            }

            for (const { id, label } of section) {
                this.addMenuItem(menu, id, label, ITEMS_WITH_BAR.has(id));
            }
        });
    }

    private addMenuItem(
        menu: PopupMenu.PopupMenu,
        id: MenuItemId,
        label: string,
        withBar = false,
    ): void {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        item.add_style_class_name('wifi-popup-item');

        const labelWidget = new St.Label({
            text: label,
            style_class: 'wifi-popup-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const valueWidget = new St.Label({
            text: PLACEHOLDER,
            style_class: 'wifi-popup-value',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });

        let barFill: St.Widget | undefined;
        if (withBar) {
            const box = new St.BoxLayout({ vertical: true, x_expand: true });

            const row = new St.BoxLayout({ x_expand: true });
            row.add_child(labelWidget);
            row.add_child(valueWidget);
            box.add_child(row);

            const barTrack = new St.Widget({
                style_class: 'wifi-bar-track',
                x_expand: true,
            });
            barFill = new St.Widget({ style_class: 'wifi-bar-fill' });
            barTrack.add_child(barFill);
            box.add_child(barTrack);

            item.add_child(box);
        } else {
            item.add_child(labelWidget);
            item.add_child(valueWidget);
        }

        menu.addMenuItem(item);
        this.menuItems.set(id, { item, label: labelWidget, value: valueWidget, barFill });
    }

    private addSignalGraph(menu: PopupMenu.PopupMenu): void {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        item.add_style_class_name('wifi-popup-item');

        this.signalGraph = new St.DrawingArea({
            style_class: 'wifi-signal-graph',
            x_expand: true,
        });
        this.signalGraph.connect('repaint', () => this.drawSignalGraph());

        item.add_child(this.signalGraph);
        menu.addMenuItem(item);
    }

    private drawSignalGraph(): void {
        if (!this.signalGraph) return;

        const cr = this.signalGraph.get_context();
        const [width, height] = this.signalGraph.get_surface_size();

        if (width === 0 || height === 0) {
            cr.$dispose();
            return;
        }

        // Background
        cr.setSourceRGBA(1, 1, 1, 0.05);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        if (this.signalHistory.length < 2) {
            cr.$dispose();
            return;
        }

        const mapY = (dbm: number): number => {
            const normalized = Math.max(
                0,
                Math.min(1, (dbm - MIN_SIGNAL_DBM) / (MAX_SIGNAL_DBM - MIN_SIGNAL_DBM)),
            );
            return height * (1 - normalized);
        };

        const stepX = width / (SIGNAL_HISTORY_MAX - 1);
        const startX = width - (this.signalHistory.length - 1) * stepX;

        const latest = this.signalHistory[this.signalHistory.length - 1];
        const quality = getSignalQuality(latest as SignalDbm);
        const [r, g, b] = SIGNAL_QUALITY_COLORS[quality] ?? [0.2, 0.52, 0.89];

        // Filled area
        cr.moveTo(startX, height);
        for (let i = 0; i < this.signalHistory.length; i++) {
            cr.lineTo(startX + i * stepX, mapY(this.signalHistory[i]));
        }
        cr.lineTo(startX + (this.signalHistory.length - 1) * stepX, height);
        cr.closePath();
        cr.setSourceRGBA(r, g, b, 0.2);
        cr.fill();

        // Line on top
        cr.moveTo(startX, mapY(this.signalHistory[0]));
        for (let i = 1; i < this.signalHistory.length; i++) {
            cr.lineTo(startX + i * stepX, mapY(this.signalHistory[i]));
        }
        cr.setSourceRGBA(r, g, b, 0.8);
        cr.setLineWidth(1.5);
        cr.stroke();

        cr.$dispose();
    }

    private updateMenuItem(id: MenuItemId, value: string, barPercent?: number): void {
        const entry = this.menuItems.get(id);
        if (!entry) return;

        entry.value.set_text(value);

        if (entry.barFill !== undefined && barPercent !== undefined) {
            const trackWidth = entry.barFill.get_parent()?.width ?? 0;
            if (trackWidth > 0) {
                entry.barFill.set_width(Math.round((barPercent / 100) * trackWidth));
            }
        }
    }

    private refresh(): void {
        if (!this.wifiService || !this.label) return;

        const info = this.wifiService.getConnectionInfo();
        this.updateIndicatorLabel(info);
        this.updateMenuContent(info);
    }

    private updateIndicatorLabel(info: WifiConnectionInfo): void {
        if (!this.icon || !this.label) return;

        this.clearGenerationStyles();

        if (!isConnected(info)) {
            this.icon.visible = false;
            this.label.visible = true;
            this.label.set_text('WiFi --');
            this.label.add_style_class_name(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.UNKNOWN]);
            return;
        }

        const iconFilename = getGenerationIconFilename(info.generation);
        if (iconFilename) {
            const iconPath = GLib.build_filenamev([this.path, 'icons', iconFilename]);
            const file = Gio.File.new_for_path(iconPath);
            this.icon.gicon = new Gio.FileIcon({ file });
            this.icon.visible = true;
            this.label.visible = false;
        } else {
            this.icon.visible = false;
            this.label.visible = true;
            this.label.set_text(getGenerationLabel(info.generation));
        }

        this.label.add_style_class_name(GENERATION_CSS_CLASSES[info.generation]);
    }

    private clearGenerationStyles(): void {
        if (!this.label) return;

        const cssClasses = Object.values(GENERATION_CSS_CLASSES) as GenerationCssClass[];
        for (const cssClass of cssClasses) {
            this.label.remove_style_class_name(cssClass);
        }
    }

    private updateMenuContent(info: WifiConnectionInfo): void {
        if (!isConnected(info)) {
            this.showDisconnectedState();
            return;
        }

        this.showConnectedState(info);
    }

    private showDisconnectedState(): void {
        for (const section of MENU_STRUCTURE) {
            for (const { id } of section) {
                const value = id === 'ssid' ? 'Not connected' : PLACEHOLDER;
                this.updateMenuItem(id, value, 0);
            }
        }

        this.signalHistory.length = 0;
        this.signalGraph?.queue_repaint();
    }

    private showConnectedState(info: ConnectedInfo): void {
        this.updateMenuItem('ssid', info.ssid);
        this.updateMenuItem('generation', getGenerationDescription(info.generation));
        this.updateMenuItem('band', this.formatBand(info));
        this.updateMenuItem(
            'bitrate',
            this.formatBitrate(info),
            this.getSpeedPercent(info),
        );
        this.updateMenuItem(
            'channelWidth',
            this.formatChannelWidth(info.channelWidth),
            this.getWidthPercent(info.channelWidth),
        );
        this.updateMenuItem('mcs', this.formatModulation(info));
        this.updateMenuItem('signal', this.formatSignal(info.signalStrength));
        this.updateMenuItem('security', info.security);
        this.updateMenuItem('bssid', info.bssid);

        this.pushSignalHistory(info.signalStrength);
    }

    private pushSignalHistory(signalStrength: SignalDbm): void {
        this.signalHistory.push(signalStrength as number);
        if (this.signalHistory.length > SIGNAL_HISTORY_MAX) {
            this.signalHistory.shift();
        }
        this.signalGraph?.queue_repaint();
    }

    private getSpeedPercent(info: ConnectedInfo): number {
        const speed = Math.max(info.txBitrate ?? 0, info.rxBitrate ?? 0, info.bitrate);
        return Math.min(100, (speed / MAX_SPEED_MBPS) * 100);
    }

    private getWidthPercent(width: ChannelWidthMHz | null): number {
        if (width === null) return 0;
        return Math.min(100, (width / MAX_CHANNEL_WIDTH_MHZ) * 100);
    }

    private formatBand(info: ConnectedInfo): string {
        return `${info.band} · Ch ${info.channel}`;
    }

    private formatBitrate(info: ConnectedInfo): string {
        const { txBitrate, rxBitrate, bitrate } = info;

        if (txBitrate !== null && rxBitrate !== null) {
            const tx = txBitrate as number;
            const rx = rxBitrate as number;
            return tx === rx ? `${tx} Mbit/s` : `↑${tx} ↓${rx} Mbit/s`;
        }

        if (txBitrate !== null) return `↑${txBitrate} Mbit/s`;
        if (rxBitrate !== null) return `↓${rxBitrate} Mbit/s`;
        return `${bitrate} Mbit/s`;
    }

    private formatChannelWidth(width: ChannelWidthMHz | null): string {
        return width !== null ? `${width} MHz` : PLACEHOLDER;
    }

    private formatModulation(info: ConnectedInfo): string {
        const parts: string[] = [];

        if (info.mcs !== null) {
            parts.push(`MCS ${info.mcs}`);
        }
        if (info.nss !== null) {
            parts.push(`${info.nss}×${info.nss} MIMO`);
        }
        if (info.guardInterval !== null) {
            parts.push(`GI ${info.guardInterval}µs`);
        }

        return parts.length > 0 ? parts.join(' · ') : PLACEHOLDER;
    }

    private formatSignal(signalStrength: SignalDbm): string {
        const quality = getSignalQuality(signalStrength);
        return `${signalStrength} dBm (${quality})`;
    }

    private startRefreshTimer(): void {
        this.refreshTimeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    private stopRefreshTimer(): void {
        if (this.refreshTimeout !== null) {
            GLib.source_remove(this.refreshTimeout);
            this.refreshTimeout = null;
        }
    }
}
