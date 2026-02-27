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
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    WifiInfoService,
    getSignalQuality,
    isConnected,
    type WifiConnectionInfo,
    type ConnectedInfo,
    type ScannedNetwork,
} from './wifiInfo.js';
import {
    GENERATION_CSS_CLASSES,
    getGenerationLabel,
    getGenerationDescription,
    getGenerationIconFilename,
} from './wifiGeneration.js';
import {
    getSignalQualityFromPercent,
    type GenerationCssClass,
    type ChannelWidthMHz,
    type SignalDbm,
    type FrequencyBand,
    type WifiGeneration,
} from './types.js';

const REFRESH_INTERVAL_SECONDS = 5;
const BACKGROUND_SCAN_INTERVAL_SECONDS = 300;
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

const SIGNAL_QUALITY_BAR_COLORS: Readonly<Record<string, string>> = {
    Excellent: '#33d17a',
    Good: '#8ff0a4',
    Fair: '#f6d32d',
    Weak: '#ff7800',
    Poor: '#e01b24',
};

type MenuItemId =
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

interface NearbyNetworkCard extends PopupMenu.PopupSubMenuMenuItem {
    _ssid: string;
}

export default class WifiSignalPlusExtension extends Extension {
    private indicator: PanelMenu.Button | null = null;
    private icon: St.Icon | null = null;
    private label: St.Label | null = null;
    private wifiService: WifiInfoService | null = null;
    private refreshTimeout: number | null = null;
    private backgroundScanTimeout: number | null = null;
    private signalGraph: St.DrawingArea | null = null;
    private readonly signalHistory: number[] = [];
    private readonly menuItems = new Map<
        MenuItemId,
        { item: PopupMenu.PopupBaseMenuItem; label: St.Label; value: St.Label; barFill?: St.Widget }
    >();
    private headerSsidLabel: St.Label | null = null;
    private headerGenerationLabel: St.Label | null = null;
    private headerBandLabel: St.Label | null = null;
    private headerIcon: St.Icon | null = null;
    private accessPointsSeparator: PopupMenu.PopupSeparatorMenuItem | null = null;
    private accessPointsSection: PopupMenu.PopupMenuSection | null = null;
    private accessPointsItems: PopupMenu.PopupBaseMenuItem[] = [];
    private accessPointsUpdatePending = false;
    private nearbySeparator: PopupMenu.PopupSeparatorMenuItem | null = null;
    private nearbySection: PopupMenu.PopupMenuSection | null = null;
    private nearbyItems: NearbyNetworkCard[] = [];
    private nearbyUpdatePending = false;
    private currentConnectedSsid: string | undefined;
    private currentConnectedBssid: string | undefined;
    private isMenuOpen = false;
    private enableEpoch = 0;

    enable(): void {
        const epoch = ++this.enableEpoch;
        this.wifiService = new WifiInfoService();
        this.wifiService
            .init()
            .then(() => {
                if (epoch !== this.enableEpoch) return;
                if (!this.wifiService) return;
                this.wifiService.requestScan();
                this.wifiService.watchDeviceSignals(() => {
                    this.wifiService?.requestScan();
                    this.scheduleRefresh();
                });
                this.createIndicator();
                this.scheduleRefresh();
                this.startRefreshTimer();
                this.startBackgroundScanTimer();
            })
            .catch(e => {
                console.error('[WiFi Signal Plus] Failed to initialize:', e);
            });
    }

    disable(): void {
        this.stopBackgroundScanTimer();
        this.stopRefreshTimer();
        this.wifiService?.unwatchDeviceSignals();
        this.clearAccessPointsItems();
        this.clearNearbyItems();
        this.indicator?.destroy();
        this.wifiService?.destroy();

        this.indicator = null;
        this.wifiService = null;
        this.icon = null;
        this.label = null;
        this.signalGraph = null;
        this.signalHistory.length = 0;
        this.menuItems.clear();
        this.headerSsidLabel = null;
        this.headerGenerationLabel = null;
        this.headerBandLabel = null;
        this.headerIcon = null;
        this.accessPointsSeparator = null;
        this.accessPointsSection = null;
        this.accessPointsItems = [];
        this.accessPointsUpdatePending = false;
        this.nearbySeparator = null;
        this.nearbySection = null;
        this.nearbyItems = [];
        this.refreshPending = false;
        this.nearbyUpdatePending = false;
        this.currentConnectedSsid = undefined;
        this.currentConnectedBssid = undefined;
        this.isMenuOpen = false;
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

        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        box.add_child(this.icon);
        box.add_child(this.label);
        this.indicator.add_child(box);
        this.buildMenu();

        Main.panel.addToStatusArea(this.uuid, this.indicator);
    }

    private buildMenu(): void {
        if (!this.indicator) return;

        const menu = this.indicator.menu as PopupMenu.PopupMenu;
        menu.box.add_style_class_name('wifi-signal-plus-popup');
        menu.connect('open-state-changed', (_menu, isOpen: boolean) => {
            this.isMenuOpen = isOpen;
            if (isOpen) {
                this.stopBackgroundScanTimer();
                this.scheduleRefresh();
            } else {
                this.startBackgroundScanTimer();
            }
            return undefined;
        });

        this.addConnectionHeader(menu);

        const sectionHeaders = ['Performance', 'Signal'];

        const SIGNAL_SECTION_INDEX = 1;

        MENU_STRUCTURE.forEach((section, index) => {
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(sectionHeaders[index]));

            if (index === SIGNAL_SECTION_INDEX) {
                this.addSignalGraph(menu);
            }

            for (const { id, label } of section) {
                this.addMenuItem(menu, id, label, ITEMS_WITH_BAR.has(id));
            }
        });

        this.accessPointsSeparator = new PopupMenu.PopupSeparatorMenuItem('Access Points');
        this.accessPointsSeparator.visible = false;
        menu.addMenuItem(this.accessPointsSeparator);
        this.accessPointsSection = new PopupMenu.PopupMenuSection();
        this.accessPointsSection.actor.visible = false;
        menu.addMenuItem(this.accessPointsSection);

        this.nearbySeparator = new PopupMenu.PopupSeparatorMenuItem('Nearby Networks');
        menu.addMenuItem(this.nearbySeparator);

        this.nearbySection = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this.nearbySection);
    }

    private addConnectionHeader(menu: PopupMenu.PopupMenu): void {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        item.add_style_class_name('wifi-connection-header');

        const leftBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.headerSsidLabel = new St.Label({
            text: PLACEHOLDER,
            style_class: 'wifi-connection-header-ssid',
        });
        leftBox.add_child(this.headerSsidLabel);

        this.headerGenerationLabel = new St.Label({
            text: PLACEHOLDER,
            style_class: 'wifi-connection-header-generation',
        });
        leftBox.add_child(this.headerGenerationLabel);

        this.headerBandLabel = new St.Label({
            text: PLACEHOLDER,
            style_class: 'wifi-connection-header-band',
        });
        leftBox.add_child(this.headerBandLabel);

        item.add_child(leftBox);

        this.headerIcon = new St.Icon({
            icon_size: 48,
            style_class: 'wifi-connection-header-icon',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        item.add_child(this.headerIcon);

        menu.addMenuItem(item);
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

    private updateHeaderIcon(generation: WifiGeneration): void {
        if (!this.headerIcon) return;

        const iconFilename = getGenerationIconFilename(generation);
        if (!iconFilename) {
            this.headerIcon.visible = false;
            return;
        }

        const iconPath = GLib.build_filenamev([this.path, 'icons', iconFilename]);
        const file = Gio.File.new_for_path(iconPath);
        this.headerIcon.gicon = new Gio.FileIcon({ file });
        this.headerIcon.visible = true;
    }

    private refreshPending = false;

    private scheduleRefresh(): void {
        this.refresh().catch(e => {
            console.error('[WiFi Signal Plus] Refresh failed:', e);
        });
    }

    private async refresh(): Promise<void> {
        if (!this.wifiService || !this.label || this.refreshPending) return;

        this.refreshPending = true;
        try {
            const info = await this.wifiService.getConnectionInfo();
            if (!this.wifiService) return;

            this.currentConnectedSsid = isConnected(info) ? info.ssid : undefined;
            this.currentConnectedBssid = isConnected(info) ? info.bssid : undefined;
            this.updateIndicatorLabel(info);
            this.updateMenuContent(info);

            if (this.isMenuOpen) {
                await this.updateAccessPoints();
                await this.updateNearbyNetworks();
            }
        } finally {
            this.refreshPending = false;
        }
    }

    private updateIndicatorLabel(info: WifiConnectionInfo): void {
        if (!this.indicator || !this.icon || !this.label) return;

        this.clearGenerationStyles();

        if (!isConnected(info)) {
            this.indicator.visible = false;
            return;
        }

        this.indicator.visible = true;

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
        this.headerSsidLabel?.set_text('Not connected');
        this.headerGenerationLabel?.set_text('');
        this.headerBandLabel?.set_text('');
        if (this.headerIcon) {
            this.headerIcon.visible = false;
        }

        for (const section of MENU_STRUCTURE) {
            for (const { id } of section) {
                this.updateMenuItem(id, PLACEHOLDER, 0);
            }
        }

        this.clearAccessPointsItems();
        this.setAccessPointsVisible(false);

        this.signalHistory.length = 0;
        this.signalGraph?.queue_repaint();
    }

    private showConnectedState(info: ConnectedInfo): void {
        this.headerSsidLabel?.set_text(info.ssid);
        this.headerGenerationLabel?.set_text(getGenerationDescription(info.generation));
        this.headerBandLabel?.set_text(this.formatBand(info));
        this.updateHeaderIcon(info.generation);
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

    private async updateAccessPoints(): Promise<void> {
        if (!this.wifiService || !this.accessPointsSection || this.accessPointsUpdatePending) return;

        if (!this.currentConnectedSsid) {
            this.clearAccessPointsItems();
            this.setAccessPointsVisible(false);
            return;
        }

        this.accessPointsUpdatePending = true;
        let accessPoints: ScannedNetwork[];
        try {
            accessPoints = await this.wifiService.getAccessPointsForSsid(this.currentConnectedSsid);
        } finally {
            this.accessPointsUpdatePending = false;
        }

        this.clearAccessPointsItems();

        if (accessPoints.length <= 1) {
            this.setAccessPointsVisible(false);
            return;
        }

        this.setAccessPointsVisible(true);

        for (const ap of accessPoints) {
            const isActive = ap.bssid === this.currentConnectedBssid?.toLowerCase();
            const row = this.createApRow(ap, isActive ? 'connected' : 'spacer');
            this.accessPointsSection.addMenuItem(row);
            this.accessPointsItems.push(row);
        }
    }

    private setAccessPointsVisible(visible: boolean): void {
        if (this.accessPointsSeparator) {
            this.accessPointsSeparator.visible = visible;
        }
        if (this.accessPointsSection) {
            this.accessPointsSection.actor.visible = visible;
        }
    }

    private clearAccessPointsItems(): void {
        for (const item of this.accessPointsItems) {
            item.destroy();
        }
        this.accessPointsItems = [];
    }

    private async updateNearbyNetworks(): Promise<void> {
        if (!this.wifiService || !this.nearbySection || this.nearbyUpdatePending) return;

        this.nearbyUpdatePending = true;
        let grouped: Map<string, ScannedNetwork[]>;
        try {
            grouped = await this.wifiService.getAvailableNetworks(this.currentConnectedSsid);
        } finally {
            this.nearbyUpdatePending = false;
        }

        const expandedSsids = new Set(
            this.nearbyItems
                .filter(card => card.menu.isOpen)
                .map(card => card._ssid),
        );

        this.clearNearbyItems();

        for (const [ssid, networks] of grouped) {
            const card = this.createNetworkCard(ssid, networks[0], networks);
            this.nearbySection.addMenuItem(card);
            this.nearbyItems.push(card);

            if (expandedSsids.has(ssid)) {
                card.menu.open(BoxPointer.PopupAnimation.NONE);
            }
        }
    }

    private createNetworkCard(
        ssid: string,
        bestAp: ScannedNetwork,
        allAps: ScannedNetwork[],
    ): NearbyNetworkCard {
        const card = new PopupMenu.PopupSubMenuMenuItem(ssid) as NearbyNetworkCard;
        card._ssid = ssid;
        card.add_style_class_name('wifi-nearby-card');

        this.createCardHeader(card, ssid, bestAp, allAps.length);

        for (const ap of allAps) {
            const row = this.createApRow(ap);
            card.menu.addMenuItem(row);
        }

        return card;
    }

    private createCardHeader(
        card: PopupMenu.PopupSubMenuMenuItem,
        ssid: string,
        bestAp: ScannedNetwork,
        apCount: number,
    ): void {
        const headerBox = new St.BoxLayout({
            style_class: 'wifi-nearby-card-header',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const genIcon = this.createGenerationIcon(bestAp.generation);
        if (genIcon) {
            headerBox.add_child(genIcon);
        }

        const ssidLabel = new St.Label({
            text: ssid,
            style_class: 'wifi-nearby-card-ssid',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(ssidLabel);

        const metricsBox = this.createCardMetrics(bestAp, apCount);
        headerBox.add_child(metricsBox);

        card.replace_child(card.label, headerBox);

        // Remove the expander (identified by .popup-menu-item-expander)
        for (const child of card.get_children()) {
            const widget = child as St.Widget;
            if (widget.has_style_class_name?.('popup-menu-item-expander')) {
                card.remove_child(child);
                child.destroy();
                break;
            }
        }
    }

    private createCardMetrics(ap: ScannedNetwork, apCount: number): St.BoxLayout {
        const box = new St.BoxLayout({
            style_class: 'wifi-nearby-card-header',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Signal % colored
        const quality = getSignalQualityFromPercent(ap.signalPercent);
        const signalColor = SIGNAL_QUALITY_BAR_COLORS[quality] ?? '#ffffff';
        const signalLabel = new St.Label({
            text: `${ap.signalPercent}%`,
            style_class: 'wifi-nearby-card-signal',
            y_align: Clutter.ActorAlign.CENTER,
        });
        signalLabel.set_style(`color: ${signalColor};`);
        box.add_child(signalLabel);

        // Band badge
        const bandBadge = new St.Label({
            text: this.formatBandShort(ap.band),
            style_class: 'wifi-nearby-badge',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(bandBadge);

        // Security badge
        const secBadge = new St.Label({
            text: ap.security,
            style_class: ap.security === 'Open'
                ? 'wifi-nearby-badge wifi-nearby-badge-open'
                : 'wifi-nearby-badge',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(secBadge);

        // AP count
        if (apCount > 1) {
            const countLabel = new St.Label({
                text: `×${apCount}`,
                style_class: 'wifi-nearby-card-count',
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(countLabel);
        }

        return box;
    }

    private createApRow(ap: ScannedNetwork, connectedIndicator: 'connected' | 'spacer' | 'none' = 'none'): PopupMenu.PopupBaseMenuItem {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        item.add_style_class_name('wifi-nearby-ap');

        if (connectedIndicator === 'connected') {
            const connectedIcon = new St.Icon({
                icon_name: 'emblem-ok-symbolic',
                icon_size: 12,
                style_class: 'wifi-ap-connected-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(connectedIcon);
        } else if (connectedIndicator === 'spacer') {
            const spacer = new St.Widget({ style_class: 'wifi-ap-icon-spacer' });
            item.add_child(spacer);
        }

        const outerBox = new St.BoxLayout({ vertical: true, x_expand: true });

        // Info row: BSSID + details + signal%
        const infoRow = new St.BoxLayout({ x_expand: true });

        const bssidLabel = new St.Label({
            text: ap.bssid.toUpperCase(),
            style_class: 'wifi-nearby-ap-bssid',
            y_align: Clutter.ActorAlign.CENTER,
        });
        infoRow.add_child(bssidLabel);

        const detailParts: string[] = [];
        detailParts.push(`Ch ${ap.channel}`);
        if ((ap.bandwidth as number) > 20) {
            detailParts.push(`${ap.bandwidth} MHz`);
        }
        if ((ap.maxBitrate as number) > 0) {
            detailParts.push(`${ap.maxBitrate} Mbit/s`);
        }

        const detailsLabel = new St.Label({
            text: detailParts.join(' · '),
            style_class: 'wifi-nearby-ap-details',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        infoRow.add_child(detailsLabel);

        const quality = getSignalQualityFromPercent(ap.signalPercent);
        const signalColor = SIGNAL_QUALITY_BAR_COLORS[quality] ?? '#ffffff';

        const signalLabel = new St.Label({
            text: `${ap.signalPercent}%`,
            style_class: 'wifi-nearby-ap-signal',
            y_align: Clutter.ActorAlign.CENTER,
        });
        signalLabel.set_style(`color: ${signalColor};`);
        infoRow.add_child(signalLabel);

        outerBox.add_child(infoRow);

        // Signal bar
        const barTrack = new St.Widget({
            style_class: 'wifi-bar-track',
            x_expand: true,
        });
        const barFill = new St.Widget({
            style_class: 'wifi-bar-fill',
        });
        barFill.set_style(`background-color: ${signalColor};`);
        barTrack.add_child(barFill);
        outerBox.add_child(barTrack);

        // Set bar width after allocation
        barTrack.connect('notify::allocation', () => {
            const trackWidth = barTrack.width;
            if (trackWidth > 0) {
                barFill.set_width(Math.round(((ap.signalPercent as number) / 100) * trackWidth));
            }
        });

        item.add_child(outerBox);
        return item;
    }

    private createGenerationIcon(generation: WifiGeneration): St.Icon | null {
        const iconFilename = getGenerationIconFilename(generation);
        if (!iconFilename) return null;

        const iconPath = GLib.build_filenamev([this.path, 'icons', iconFilename]);
        const file = Gio.File.new_for_path(iconPath);

        return new St.Icon({
            gicon: new Gio.FileIcon({ file }),
            icon_size: 16,
            style_class: 'wifi-nearby-card-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    private formatBandShort(band: FrequencyBand): string {
        if (band === '2.4 GHz') return '2.4G';
        if (band === '5 GHz') return '5G';
        if (band === '6 GHz') return '6G';
        return band;
    }

    private clearNearbyItems(): void {
        for (const item of this.nearbyItems) {
            item.destroy();
        }
        this.nearbyItems = [];
    }

    private startRefreshTimer(): void {
        this.stopRefreshTimer();
        this.refreshTimeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                this.scheduleRefresh();
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

    private startBackgroundScanTimer(): void {
        this.stopBackgroundScanTimer();
        this.backgroundScanTimeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            BACKGROUND_SCAN_INTERVAL_SECONDS,
            () => {
                this.wifiService?.requestScan();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    private stopBackgroundScanTimer(): void {
        if (this.backgroundScanTimeout !== null) {
            GLib.source_remove(this.backgroundScanTimeout);
            this.backgroundScanTimeout = null;
        }
    }
}
