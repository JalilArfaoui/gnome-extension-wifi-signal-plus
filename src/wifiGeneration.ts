/**
 * WiFi Generation Detection
 *
 * Parses `iw dev <interface> link` output to detect WiFi 4/5/6/7.
 */

import {
    type IwLinkInfo,
    type WifiGeneration,
    type McsIndex,
    type SpatialStreams,
    type GuardIntervalUs,
    type ChannelWidthMHz,
    type BitrateMbps,
    type SignalDbm,
    type FrequencyMHz,
    WIFI_GENERATIONS,
    IEEE_STANDARDS,
    GENERATION_CSS_CLASSES,
    GUARD_INTERVALS,
    HE_GI_INDEX_MAP,
    createEmptyIwLinkInfo,
    isKnownGeneration,
    asMcsIndex,
    asSpatialStreams,
    asChannelWidthMHz,
    asBitrateMbps,
    asSignalDbm,
    asFrequencyMHz,
} from './types.js';

export {
    type IwLinkInfo,
    type WifiGeneration,
    WIFI_GENERATIONS,
    IEEE_STANDARDS,
    GENERATION_CSS_CLASSES,
    createEmptyIwLinkInfo,
    isKnownGeneration,
};

interface BitrateParseResult {
    readonly bitrate: BitrateMbps | null;
    readonly generation: WifiGeneration;
    readonly mcs: McsIndex | null;
    readonly nss: SpatialStreams | null;
    readonly guardInterval: GuardIntervalUs | null;
    readonly channelWidth: ChannelWidthMHz | null;
}

interface MutableParseResult {
    generation: WifiGeneration;
    standard: (typeof IEEE_STANDARDS)[WifiGeneration] | null;
    mcs: McsIndex | null;
    nss: SpatialStreams | null;
    guardInterval: GuardIntervalUs | null;
    channelWidth: ChannelWidthMHz | null;
    txBitrate: BitrateMbps | null;
    rxBitrate: BitrateMbps | null;
    signal: SignalDbm | null;
    frequency: FrequencyMHz | null;
    ssid: string | null;
    bssid: string | null;
}

interface GenerationDetectionResult {
    readonly generation: WifiGeneration;
    readonly mcs: McsIndex | null;
    readonly nss: SpatialStreams | null;
    readonly guardInterval: GuardIntervalUs | null;
}

export function parseIwLinkOutput(iwOutput: string): IwLinkInfo {
    if (!iwOutput || iwOutput.includes('Not connected')) {
        return createEmptyIwLinkInfo();
    }

    const result = createMutableResult();

    for (const line of iwOutput.split('\n')) {
        parseLine(line.trim(), result);
    }

    detectLegacyGeneration(result);

    return freezeResult(result);
}

function createMutableResult(): MutableParseResult {
    return {
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
    };
}

const WIFI_1_MAX_BITRATE = 11;
const FREQ_5GHZ_START = 5000;

function detectLegacyGeneration(result: MutableParseResult): void {
    if (result.generation !== WIFI_GENERATIONS.UNKNOWN) return;
    if (result.frequency === null) return;

    if (result.frequency >= FREQ_5GHZ_START) {
        result.generation = WIFI_GENERATIONS.WIFI_2;
        return;
    }

    const maxBitrate = Math.max(
        (result.txBitrate as number | null) ?? 0,
        (result.rxBitrate as number | null) ?? 0
    );
    if (maxBitrate === 0) return;

    result.generation =
        maxBitrate <= WIFI_1_MAX_BITRATE ? WIFI_GENERATIONS.WIFI_1 : WIFI_GENERATIONS.WIFI_3;
}

function freezeResult(result: MutableParseResult): IwLinkInfo {
    if (isKnownGeneration(result.generation)) {
        result.standard = IEEE_STANDARDS[result.generation];
    }
    return Object.freeze(result) as IwLinkInfo;
}

function parseLine(line: string, result: MutableParseResult): void {
    parseConnectionInfo(line, result);
    parseBitrateLines(line, result);
}

function parseConnectionInfo(line: string, result: MutableParseResult): void {
    if (line.startsWith('SSID:')) {
        result.ssid = line.substring(5).trim();
        return;
    }

    if (line.startsWith('Connected to')) {
        const match = line.match(/Connected to ([0-9a-f:]+)/i);
        if (match) {
            result.bssid = match[1];
        }
        return;
    }

    if (line.startsWith('freq:')) {
        const value = parseFloat(line.substring(5).trim());
        if (!Number.isNaN(value)) {
            result.frequency = asFrequencyMHz(value);
        }
        return;
    }

    if (line.startsWith('signal:')) {
        const match = line.match(/signal:\s*(-?\d+)/);
        if (match) {
            result.signal = asSignalDbm(parseInt(match[1], 10));
        }
    }
}

function parseBitrateLines(line: string, result: MutableParseResult): void {
    if (line.startsWith('tx bitrate:')) {
        const bitrateInfo = parseBitrateLine(line);
        result.txBitrate = bitrateInfo.bitrate;
        applyBitrateInfoIfDetected(bitrateInfo, result);
        return;
    }

    if (line.startsWith('rx bitrate:')) {
        const bitrateInfo = parseBitrateLine(line);
        result.rxBitrate = bitrateInfo.bitrate;
        if (result.generation === WIFI_GENERATIONS.UNKNOWN) {
            applyBitrateInfoIfDetected(bitrateInfo, result);
        }
    }
}

function applyBitrateInfoIfDetected(
    bitrateInfo: BitrateParseResult,
    result: MutableParseResult
): void {
    if (bitrateInfo.generation === WIFI_GENERATIONS.UNKNOWN) {
        return;
    }
    result.generation = bitrateInfo.generation;
    result.mcs = bitrateInfo.mcs;
    result.nss = bitrateInfo.nss;
    result.guardInterval = bitrateInfo.guardInterval;
    result.channelWidth = bitrateInfo.channelWidth;
}

function parseBitrateLine(line: string): BitrateParseResult {
    const bitrate = parseNumericValue(line, /(\d+\.?\d*)\s*MBit\/s/);
    const channelWidth = parseNumericValue(line, /(\d+)MHz/);
    const generationInfo = detectWifiGeneration(line);

    return {
        bitrate: bitrate !== null ? asBitrateMbps(bitrate) : null,
        generation: generationInfo.generation,
        mcs: generationInfo.mcs,
        nss: generationInfo.nss,
        guardInterval: generationInfo.guardInterval,
        channelWidth: channelWidth !== null ? asChannelWidthMHz(channelWidth) : null,
    };
}

function parseNumericValue(line: string, pattern: RegExp): number | null {
    const match = line.match(pattern);
    if (!match) return null;
    const value = parseFloat(match[1]);
    return Number.isNaN(value) ? null : value;
}

function detectWifiGeneration(line: string): GenerationDetectionResult {
    return (
        tryParseEHT(line) ??
        tryParseHE(line) ??
        tryParseVHT(line) ??
        tryParseHT(line) ?? {
            generation: WIFI_GENERATIONS.UNKNOWN,
            mcs: null,
            nss: null,
            guardInterval: null,
        }
    );
}

function tryParseEHT(line: string): GenerationDetectionResult | null {
    if (!line.includes('EHT-MCS')) return null;

    return {
        generation: WIFI_GENERATIONS.WIFI_7,
        mcs: parseMcs(line, /EHT-MCS\s+(\d+)/),
        nss: parseNss(line, /EHT-NSS\s+(\d+)/),
        guardInterval: parseHeGuardInterval(line, 'EHT-GI'),
    };
}

function tryParseHE(line: string): GenerationDetectionResult | null {
    if (!line.includes('HE-MCS')) return null;

    return {
        generation: WIFI_GENERATIONS.WIFI_6,
        mcs: parseMcs(line, /HE-MCS\s+(\d+)/),
        nss: parseNss(line, /HE-NSS\s+(\d+)/),
        guardInterval: parseHeGuardInterval(line, 'HE-GI'),
    };
}

function tryParseVHT(line: string): GenerationDetectionResult | null {
    if (!line.includes('VHT-MCS')) return null;

    return {
        generation: WIFI_GENERATIONS.WIFI_5,
        mcs: parseMcs(line, /VHT-MCS\s+(\d+)/),
        nss: parseNss(line, /VHT-NSS\s+(\d+)/),
        guardInterval: line.includes('short GI') ? GUARD_INTERVALS.SHORT : GUARD_INTERVALS.NORMAL,
    };
}

function tryParseHT(line: string): GenerationDetectionResult | null {
    if (!line.match(/\bMCS\s+\d+/) || line.includes('-MCS')) return null;

    const mcs = parseMcs(line, /\bMCS\s+(\d+)/);

    return {
        generation: WIFI_GENERATIONS.WIFI_4,
        mcs,
        nss: mcs !== null ? asSpatialStreams(Math.floor(mcs / 8) + 1) : null,
        guardInterval: line.includes('short GI') ? GUARD_INTERVALS.SHORT : GUARD_INTERVALS.NORMAL,
    };
}

function parseMcs(line: string, pattern: RegExp): McsIndex | null {
    const value = parseNumericValue(line, pattern);
    return value !== null ? asMcsIndex(value) : null;
}

function parseNss(line: string, pattern: RegExp): SpatialStreams | null {
    const value = parseNumericValue(line, pattern);
    return value !== null ? asSpatialStreams(value) : null;
}

function parseHeGuardInterval(line: string, prefix: string): GuardIntervalUs {
    const pattern = new RegExp(`${prefix}\\s+(\\d+)`);
    const match = line.match(pattern);

    if (!match) return GUARD_INTERVALS.NORMAL;

    const giIndex = parseInt(match[1], 10) as 0 | 1 | 2;
    return HE_GI_INDEX_MAP[giIndex] ?? GUARD_INTERVALS.NORMAL;
}

export function parseIwScanDump(output: string): Map<string, WifiGeneration> {
    const result = new Map<string, WifiGeneration>();
    if (!output) return result;

    const bssBlocks = output.split(/^BSS /m);

    for (const block of bssBlocks) {
        const bssidMatch = block.match(/^([0-9a-f:]{17})/i);
        if (!bssidMatch) continue;

        const bssid = bssidMatch[1].toLowerCase();
        result.set(bssid, detectScanGeneration(block));
    }

    return result;
}

function detectScanGeneration(block: string): WifiGeneration {
    if (block.includes('EHT capabilities')) return WIFI_GENERATIONS.WIFI_7;
    if (block.includes('HE capabilities')) return WIFI_GENERATIONS.WIFI_6;
    if (block.includes('VHT capabilities') || block.includes('VHT operation')) return WIFI_GENERATIONS.WIFI_5;
    if (block.includes('HT capabilities') || block.includes('HT operation')) return WIFI_GENERATIONS.WIFI_4;
    return WIFI_GENERATIONS.UNKNOWN;
}

export function getGenerationLabel(generation: WifiGeneration): string {
    return isKnownGeneration(generation) ? `WiFi ${generation}` : 'WiFi';
}

export function getGenerationDescription(generation: WifiGeneration): string {
    return isKnownGeneration(generation)
        ? `WiFi ${generation} (${IEEE_STANDARDS[generation]})`
        : 'WiFi';
}

const GENERATION_ICON_FILENAMES: Record<WifiGeneration, string | null> = {
    [WIFI_GENERATIONS.WIFI_1]: 'wifi-1.svg',
    [WIFI_GENERATIONS.WIFI_2]: 'wifi-2.svg',
    [WIFI_GENERATIONS.WIFI_3]: 'wifi-3.svg',
    [WIFI_GENERATIONS.WIFI_4]: 'wifi-4.png',
    [WIFI_GENERATIONS.WIFI_5]: 'wifi-5.png',
    [WIFI_GENERATIONS.WIFI_6]: 'wifi-6.png',
    [WIFI_GENERATIONS.WIFI_7]: 'wifi-7.png',
    [WIFI_GENERATIONS.UNKNOWN]: null,
} as const;

export function getGenerationIconFilename(generation: WifiGeneration): string | null {
    return GENERATION_ICON_FILENAMES[generation];
}
