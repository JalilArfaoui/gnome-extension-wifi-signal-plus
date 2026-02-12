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

export default class WifiSignalPlusExtension extends Extension {
    private indicator: PanelMenu.Button | null = null;
    private icon: St.Icon | null = null;
    private label: St.Label | null = null;
    private wifiService: WifiInfoService | null = null;
    private refreshTimeout: number | null = null;
    private readonly menuItems = new Map<MenuItemId, PopupMenu.PopupMenuItem>();

    enable(): void {
        this.wifiService = new WifiInfoService();
        this.wifiService
            .init()
            .then(() => {
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

        MENU_STRUCTURE.forEach((section, index) => {
            for (const { id, label } of section) {
                this.addMenuItem(menu, id, label);
            }

            // Add separator between sections (not after last)
            if (index < MENU_STRUCTURE.length - 1) {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
        });
    }

    private addMenuItem(menu: PopupMenu.PopupMenu, id: MenuItemId, label: string): void {
        const item = new PopupMenu.PopupMenuItem(`${label}: ${PLACEHOLDER}`, { reactive: false });
        menu.addMenuItem(item);
        this.menuItems.set(id, item);
    }

    private updateMenuItem(id: MenuItemId, label: string, value: string): void {
        const item = this.menuItems.get(id);
        item?.label.set_text(`${label}: ${value}`);
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
            for (const { id, label } of section) {
                const value = id === 'ssid' ? 'Not connected' : PLACEHOLDER;
                this.updateMenuItem(id, label, value);
            }
        }
    }

    private showConnectedState(info: ConnectedInfo): void {
        this.updateMenuItem('ssid', 'Network', info.ssid);
        this.updateMenuItem('generation', 'Generation', getGenerationDescription(info.generation));
        this.updateMenuItem('band', 'Band', this.formatBand(info));
        this.updateMenuItem('bitrate', 'Speed', this.formatBitrate(info));
        this.updateMenuItem('channelWidth', 'Width', this.formatChannelWidth(info.channelWidth));
        this.updateMenuItem('mcs', 'Modulation', this.formatModulation(info));
        this.updateMenuItem('signal', 'Signal', this.formatSignal(info.signalStrength));
        this.updateMenuItem('security', 'Security', info.security);
        this.updateMenuItem('bssid', 'BSSID', info.bssid);
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
