import { describe, it, expect } from 'vitest';
import {
    parseIwLinkOutput,
    createEmptyIwLinkInfo,
    WIFI_GENERATIONS,
    IEEE_STANDARDS,
    GENERATION_CSS_CLASSES,
    getGenerationLabel,
    getGenerationDescription,
    isKnownGeneration,
} from './wifiGeneration';
import { GUARD_INTERVALS } from './types';

describe('createEmptyIwLinkInfo', () => {
    it('should create an object with all null values and UNKNOWN generation', () => {
        const info = createEmptyIwLinkInfo();

        expect(info.generation).toBe(WIFI_GENERATIONS.UNKNOWN);
        expect(info.standard).toBeNull();
        expect(info.mcs).toBeNull();
        expect(info.nss).toBeNull();
        expect(info.guardInterval).toBeNull();
        expect(info.channelWidth).toBeNull();
        expect(info.txBitrate).toBeNull();
        expect(info.rxBitrate).toBeNull();
        expect(info.signal).toBeNull();
        expect(info.frequency).toBeNull();
        expect(info.ssid).toBeNull();
        expect(info.bssid).toBeNull();
    });

    it('should return a frozen object', () => {
        const info = createEmptyIwLinkInfo();
        expect(Object.isFrozen(info)).toBe(true);
    });
});

describe('isKnownGeneration', () => {
    it('should return true for known generations', () => {
        expect(isKnownGeneration(WIFI_GENERATIONS.WIFI_4)).toBe(true);
        expect(isKnownGeneration(WIFI_GENERATIONS.WIFI_5)).toBe(true);
        expect(isKnownGeneration(WIFI_GENERATIONS.WIFI_6)).toBe(true);
        expect(isKnownGeneration(WIFI_GENERATIONS.WIFI_7)).toBe(true);
    });

    it('should return false for UNKNOWN', () => {
        expect(isKnownGeneration(WIFI_GENERATIONS.UNKNOWN)).toBe(false);
    });
});

describe('parseIwLinkOutput', () => {
    it('should return empty info for empty input', () => {
        const result = parseIwLinkOutput('');

        expect(result.generation).toBe(WIFI_GENERATIONS.UNKNOWN);
        expect(result.ssid).toBeNull();
    });

    it('should return empty info for "Not connected"', () => {
        const result = parseIwLinkOutput('Not connected.');

        expect(result.generation).toBe(WIFI_GENERATIONS.UNKNOWN);
    });

    it('should return a frozen result', () => {
        const result = parseIwLinkOutput('Connected to 00:00:00:00:00:00 (on wlan0)');
        expect(Object.isFrozen(result)).toBe(true);
    });

    describe('WiFi 6 (HE) detection', () => {
        it('should detect WiFi 6 from real iw output', () => {
            const iwOutput = `Connected to ae:8b:a9:51:30:23 (on wlp192s0)
	SSID: LaccordeonCoworking
	freq: 5220.0
	RX: 1533905496 bytes (1321800 packets)
	TX: 220138288 bytes (525917 packets)
	signal: -39 dBm
	rx bitrate: 573.5 MBit/s 40MHz HE-MCS 11 HE-NSS 2 HE-GI 0 HE-DCM 0
	tx bitrate: 573.5 MBit/s 40MHz HE-MCS 11 HE-NSS 2 HE-GI 0 HE-DCM 0
	bss flags: short-slot-time
	dtim period: 3
	beacon int: 100`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_6);
            expect(result.standard).toBe('802.11ax');
            expect(result.ssid).toBe('LaccordeonCoworking');
            expect(result.bssid).toBe('ae:8b:a9:51:30:23');
            expect(result.frequency).toBe(5220.0);
            expect(result.signal).toBe(-39);
            expect(result.mcs).toBe(11);
            expect(result.nss).toBe(2);
            expect(result.guardInterval).toBe(GUARD_INTERVALS.NORMAL);
            expect(result.channelWidth).toBe(40);
            expect(result.txBitrate).toBe(573.5);
            expect(result.rxBitrate).toBe(573.5);
        });

        it('should parse all HE guard interval values correctly', () => {
            const testCases = [
                { gi: '0', expected: GUARD_INTERVALS.NORMAL },
                { gi: '1', expected: GUARD_INTERVALS.LONG_1 },
                { gi: '2', expected: GUARD_INTERVALS.LONG_2 },
            ] as const;

            for (const { gi, expected } of testCases) {
                const iwOutput = `Connected to 00:00:00:00:00:00 (on wlan0)
	tx bitrate: 100 MBit/s HE-MCS 5 HE-NSS 1 HE-GI ${gi}`;

                const result = parseIwLinkOutput(iwOutput);

                expect(result.guardInterval).toBe(expected);
            }
        });
    });

    describe('WiFi 5 (VHT) detection', () => {
        it('should detect WiFi 5 connection', () => {
            const iwOutput = `Connected to 00:11:22:33:44:55 (on wlan0)
	SSID: MyNetwork
	freq: 5180
	signal: -55 dBm
	tx bitrate: 866.7 MBit/s VHT-MCS 9 80MHz VHT-NSS 2
	rx bitrate: 650.0 MBit/s VHT-MCS 7 80MHz short GI VHT-NSS 2`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_5);
            expect(result.standard).toBe('802.11ac');
            expect(result.mcs).toBe(9);
            expect(result.nss).toBe(2);
            expect(result.channelWidth).toBe(80);
        });

        it('should detect short GI for VHT', () => {
            const iwOutput = `Connected to 00:00:00:00:00:00 (on wlan0)
	tx bitrate: 100 MBit/s VHT-MCS 5 20MHz short GI VHT-NSS 1`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.guardInterval).toBe(GUARD_INTERVALS.SHORT);
        });

        it('should use normal GI when short GI not present', () => {
            const iwOutput = `Connected to 00:00:00:00:00:00 (on wlan0)
	tx bitrate: 100 MBit/s VHT-MCS 5 20MHz VHT-NSS 1`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.guardInterval).toBe(GUARD_INTERVALS.NORMAL);
        });
    });

    describe('WiFi 4 (HT) detection', () => {
        it('should detect WiFi 4 connection', () => {
            const iwOutput = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	SSID: OldRouter
	freq: 2437
	signal: -65 dBm
	tx bitrate: 72.2 MBit/s MCS 7 20MHz short GI
	rx bitrate: 65.0 MBit/s MCS 6 20MHz`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_4);
            expect(result.standard).toBe('802.11n');
            expect(result.mcs).toBe(7);
            expect(result.nss).toBe(1);
            expect(result.channelWidth).toBe(20);
            expect(result.guardInterval).toBe(GUARD_INTERVALS.SHORT);
        });

        it('should derive NSS from MCS index', () => {
            const testCases = [
                { mcs: 0, expectedNss: 1 },
                { mcs: 7, expectedNss: 1 },
                { mcs: 8, expectedNss: 2 },
                { mcs: 15, expectedNss: 2 },
                { mcs: 16, expectedNss: 3 },
                { mcs: 23, expectedNss: 3 },
            ];

            for (const { mcs, expectedNss } of testCases) {
                const iwOutput = `Connected to 00:00:00:00:00:00 (on wlan0)
	tx bitrate: 100 MBit/s MCS ${mcs} 20MHz`;

                const result = parseIwLinkOutput(iwOutput);

                expect(result.nss).toBe(expectedNss);
            }
        });
    });

    describe('WiFi 7 (EHT) detection', () => {
        it('should detect WiFi 7 connection', () => {
            const iwOutput = `Connected to 11:22:33:44:55:66 (on wlan0)
	SSID: WiFi7Network
	freq: 6115
	signal: -45 dBm
	tx bitrate: 2882.4 MBit/s 160MHz EHT-MCS 13 EHT-NSS 2 EHT-GI 0
	rx bitrate: 2882.4 MBit/s 160MHz EHT-MCS 13 EHT-NSS 2 EHT-GI 0`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_7);
            expect(result.standard).toBe('802.11be');
            expect(result.mcs).toBe(13);
            expect(result.nss).toBe(2);
            expect(result.channelWidth).toBe(160);
        });
    });

    describe('fallback to RX bitrate', () => {
        it('should use RX bitrate when TX has no generation info', () => {
            const iwOutput = `Connected to 00:00:00:00:00:00 (on wlan0)
	tx bitrate: 100 MBit/s
	rx bitrate: 200 MBit/s HE-MCS 9 HE-NSS 2 HE-GI 1 40MHz`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_6);
            expect(result.txBitrate).toBe(100);
            expect(result.rxBitrate).toBe(200);
        });
    });
});

describe('getGenerationLabel', () => {
    it('should return "WiFi X" for known generations', () => {
        expect(getGenerationLabel(WIFI_GENERATIONS.WIFI_4)).toBe('WiFi 4');
        expect(getGenerationLabel(WIFI_GENERATIONS.WIFI_5)).toBe('WiFi 5');
        expect(getGenerationLabel(WIFI_GENERATIONS.WIFI_6)).toBe('WiFi 6');
        expect(getGenerationLabel(WIFI_GENERATIONS.WIFI_7)).toBe('WiFi 7');
    });

    it('should return "WiFi" for UNKNOWN', () => {
        expect(getGenerationLabel(WIFI_GENERATIONS.UNKNOWN)).toBe('WiFi');
    });
});

describe('getGenerationDescription', () => {
    it('should return full description with IEEE standard', () => {
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_4)).toBe('WiFi 4 (802.11n)');
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_5)).toBe('WiFi 5 (802.11ac)');
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_6)).toBe('WiFi 6 (802.11ax)');
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_7)).toBe('WiFi 7 (802.11be)');
    });

    it('should return "WiFi" for UNKNOWN', () => {
        expect(getGenerationDescription(WIFI_GENERATIONS.UNKNOWN)).toBe('WiFi');
    });
});

describe('IEEE_STANDARDS', () => {
    it('should map all generations to their IEEE standards', () => {
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_4]).toBe('802.11n');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_5]).toBe('802.11ac');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_6]).toBe('802.11ax');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_7]).toBe('802.11be');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.UNKNOWN]).toBe('Unknown');
    });
});

describe('GENERATION_CSS_CLASSES', () => {
    it('should map all generations to CSS classes', () => {
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_4]).toBe('wifi-gen-4');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_5]).toBe('wifi-gen-5');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_6]).toBe('wifi-gen-6');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_7]).toBe('wifi-gen-7');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.UNKNOWN]).toBe('wifi-disconnected');
    });

    it('should use template literal type pattern', () => {
        // Type check: all values should match the GenerationCssClass type
        const classes = Object.values(GENERATION_CSS_CLASSES);
        expect(classes).toContain('wifi-gen-4');
        expect(classes).toContain('wifi-gen-5');
        expect(classes).toContain('wifi-gen-6');
        expect(classes).toContain('wifi-gen-7');
        expect(classes).toContain('wifi-disconnected');
    });
});
