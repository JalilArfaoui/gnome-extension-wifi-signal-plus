import { describe, it, expect } from 'vitest';
import {
    parseIwLinkOutput,
    parseIwScanDump,
    createEmptyIwLinkInfo,
    WIFI_GENERATIONS,
    IEEE_STANDARDS,
    GENERATION_CSS_CLASSES,
    getGenerationLabel,
    getGenerationDescription,
    getGenerationIconFilename,
    isKnownGeneration,
} from './wifiGeneration';
import {
    GUARD_INTERVALS,
    asBitrateMbps,
    asSignalPercent,
    getSignalQualityFromPercent,
    getSpeedQuality,
} from './types';

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
        expect(isKnownGeneration(WIFI_GENERATIONS.WIFI_1)).toBe(true);
        expect(isKnownGeneration(WIFI_GENERATIONS.WIFI_2)).toBe(true);
        expect(isKnownGeneration(WIFI_GENERATIONS.WIFI_3)).toBe(true);
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

describe('legacy WiFi detection', () => {
    describe('WiFi 2 (802.11a) - 5 GHz legacy', () => {
        it('should detect WiFi 2 for 5 GHz without generation markers', () => {
            const iwOutput = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	SSID: LegacyNetwork
	freq: 5180
	signal: -60 dBm
	tx bitrate: 54.0 MBit/s
	rx bitrate: 48.0 MBit/s`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_2);
            expect(result.standard).toBe('802.11a');
        });
    });

    describe('WiFi 1 (802.11b) - 2.4 GHz low bitrate', () => {
        it('should detect WiFi 1 for 2.4 GHz with bitrate <= 11 Mbps', () => {
            const iwOutput = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	SSID: VeryOldNetwork
	freq: 2437
	signal: -70 dBm
	tx bitrate: 11.0 MBit/s
	rx bitrate: 5.5 MBit/s`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_1);
            expect(result.standard).toBe('802.11b');
        });

        it('should detect WiFi 1 for 2.4 GHz with 1 Mbps bitrate', () => {
            const iwOutput = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	freq: 2412
	signal: -80 dBm
	tx bitrate: 1.0 MBit/s`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_1);
        });
    });

    describe('WiFi 3 (802.11g) - 2.4 GHz high bitrate', () => {
        it('should detect WiFi 3 for 2.4 GHz with bitrate > 11 Mbps', () => {
            const iwOutput = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	SSID: OlderNetwork
	freq: 2437
	signal: -55 dBm
	tx bitrate: 54.0 MBit/s
	rx bitrate: 36.0 MBit/s`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_3);
            expect(result.standard).toBe('802.11g');
        });

        it('should detect WiFi 3 for 2.4 GHz with 12 Mbps bitrate', () => {
            const iwOutput = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	freq: 2462
	signal: -65 dBm
	tx bitrate: 12.0 MBit/s`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_3);
        });
    });

    describe('no legacy detection when generation already known', () => {
        it('should not override WiFi 4 detection with legacy', () => {
            const iwOutput = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	freq: 2437
	signal: -65 dBm
	tx bitrate: 72.2 MBit/s MCS 7 20MHz short GI`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.WIFI_4);
        });
    });

    describe('no legacy detection without enough info', () => {
        it('should remain UNKNOWN without frequency', () => {
            const iwOutput = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	signal: -65 dBm
	tx bitrate: 54.0 MBit/s`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.UNKNOWN);
        });

        it('should remain UNKNOWN without bitrate on 2.4 GHz', () => {
            const iwOutput = `Connected to aa:bb:cc:dd:ee:ff (on wlan0)
	freq: 2437
	signal: -65 dBm`;

            const result = parseIwLinkOutput(iwOutput);

            expect(result.generation).toBe(WIFI_GENERATIONS.UNKNOWN);
        });
    });
});

describe('getGenerationLabel', () => {
    it('should return "WiFi X" for known generations', () => {
        expect(getGenerationLabel(WIFI_GENERATIONS.WIFI_1)).toBe('WiFi 1');
        expect(getGenerationLabel(WIFI_GENERATIONS.WIFI_2)).toBe('WiFi 2');
        expect(getGenerationLabel(WIFI_GENERATIONS.WIFI_3)).toBe('WiFi 3');
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
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_1)).toBe('WiFi 1 (802.11b)');
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_2)).toBe('WiFi 2 (802.11a)');
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_3)).toBe('WiFi 3 (802.11g)');
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_4)).toBe('WiFi 4 (802.11n)');
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_5)).toBe('WiFi 5 (802.11ac)');
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_6)).toBe('WiFi 6 (802.11ax)');
        expect(getGenerationDescription(WIFI_GENERATIONS.WIFI_7)).toBe('WiFi 7 (802.11be)');
    });

    it('should return "WiFi" for UNKNOWN', () => {
        expect(getGenerationDescription(WIFI_GENERATIONS.UNKNOWN)).toBe('WiFi');
    });
});

describe('getGenerationIconFilename', () => {
    it('should return PNG filename for WiFi 4-7', () => {
        expect(getGenerationIconFilename(WIFI_GENERATIONS.WIFI_4)).toBe('wifi-4.png');
        expect(getGenerationIconFilename(WIFI_GENERATIONS.WIFI_5)).toBe('wifi-5.png');
        expect(getGenerationIconFilename(WIFI_GENERATIONS.WIFI_6)).toBe('wifi-6.png');
        expect(getGenerationIconFilename(WIFI_GENERATIONS.WIFI_7)).toBe('wifi-7.png');
    });

    it('should return SVG filename for WiFi 1-3', () => {
        expect(getGenerationIconFilename(WIFI_GENERATIONS.WIFI_1)).toBe('wifi-1.svg');
        expect(getGenerationIconFilename(WIFI_GENERATIONS.WIFI_2)).toBe('wifi-2.svg');
        expect(getGenerationIconFilename(WIFI_GENERATIONS.WIFI_3)).toBe('wifi-3.svg');
    });

    it('should return null for UNKNOWN', () => {
        expect(getGenerationIconFilename(WIFI_GENERATIONS.UNKNOWN)).toBeNull();
    });
});

describe('IEEE_STANDARDS', () => {
    it('should map all generations to their IEEE standards', () => {
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_1]).toBe('802.11b');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_2]).toBe('802.11a');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_3]).toBe('802.11g');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_4]).toBe('802.11n');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_5]).toBe('802.11ac');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_6]).toBe('802.11ax');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.WIFI_7]).toBe('802.11be');
        expect(IEEE_STANDARDS[WIFI_GENERATIONS.UNKNOWN]).toBe('Unknown');
    });
});

describe('GENERATION_CSS_CLASSES', () => {
    it('should map all generations to CSS classes', () => {
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_1]).toBe('wifi-gen-1');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_2]).toBe('wifi-gen-2');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_3]).toBe('wifi-gen-3');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_4]).toBe('wifi-gen-4');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_5]).toBe('wifi-gen-5');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_6]).toBe('wifi-gen-6');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.WIFI_7]).toBe('wifi-gen-7');
        expect(GENERATION_CSS_CLASSES[WIFI_GENERATIONS.UNKNOWN]).toBe('wifi-disconnected');
    });

    it('should use template literal type pattern', () => {
        const classes = Object.values(GENERATION_CSS_CLASSES);
        expect(classes).toContain('wifi-gen-1');
        expect(classes).toContain('wifi-gen-2');
        expect(classes).toContain('wifi-gen-3');
        expect(classes).toContain('wifi-gen-4');
        expect(classes).toContain('wifi-gen-5');
        expect(classes).toContain('wifi-gen-6');
        expect(classes).toContain('wifi-gen-7');
        expect(classes).toContain('wifi-disconnected');
    });
});

describe('parseIwScanDump', () => {
    it('should return an empty map for empty input', () => {
        const result = parseIwScanDump('');
        expect(result.size).toBe(0);
    });

    it('should detect WiFi 6 via HE capabilities', () => {
        const output = `BSS ae:8b:a9:51:30:23(on wlp192s0) -- associated
\tlast seen: 340 ms ago
\tTSF: 123456789 usec (0d, 00:00:00)
\tfreq: 5220
\tbeacon interval: 100 TUs
\tcapability: ESS Privacy ShortSlotTime (0x0411)
\tsignal: -39.00 dBm
\tSSID: MyNetwork
\tHT capabilities:
\t\tCapabilities: 0x0963
\tHT operation:
\t\t * primary channel: 44
\tVHT capabilities:
\t\tVHT Capabilities (0x338b79b2):
\tVHT operation:
\t\t * channel width: 1 (80 MHz)
\tHE capabilities:
\t\tHE MAC Capabilities (0x000801185018):
\t\tHE PHY Capabilities (0x043c2e090f):`;

        const result = parseIwScanDump(output);

        expect(result.size).toBe(1);
        expect(result.get('ae:8b:a9:51:30:23')).toBe(WIFI_GENERATIONS.WIFI_6);
    });

    it('should detect WiFi 7 via EHT capabilities', () => {
        const output = `BSS 11:22:33:44:55:66(on wlan0)
\tfreq: 6115
\tsignal: -45.00 dBm
\tSSID: WiFi7Network
\tHT capabilities:
\t\tCapabilities: 0x0963
\tVHT capabilities:
\t\tVHT Capabilities (0x338b79b2):
\tHE capabilities:
\t\tHE MAC Capabilities (0x000801185018):
\tEHT capabilities:
\t\tEHT MAC Capabilities (0x0000):`;

        const result = parseIwScanDump(output);

        expect(result.size).toBe(1);
        expect(result.get('11:22:33:44:55:66')).toBe(WIFI_GENERATIONS.WIFI_7);
    });

    it('should detect WiFi 5 via VHT capabilities', () => {
        const output = `BSS aa:bb:cc:dd:ee:ff(on wlan0)
\tfreq: 5180
\tsignal: -55.00 dBm
\tSSID: AcNetwork
\tHT capabilities:
\t\tCapabilities: 0x0963
\tHT operation:
\t\t * primary channel: 36
\tVHT capabilities:
\t\tVHT Capabilities (0x338b79b2):
\tVHT operation:
\t\t * channel width: 1 (80 MHz)`;

        const result = parseIwScanDump(output);

        expect(result.size).toBe(1);
        expect(result.get('aa:bb:cc:dd:ee:ff')).toBe(WIFI_GENERATIONS.WIFI_5);
    });

    it('should detect WiFi 4 via HT capabilities only', () => {
        const output = `BSS 00:11:22:33:44:55(on wlan0)
\tfreq: 2437
\tsignal: -65.00 dBm
\tSSID: OldRouter
\tHT capabilities:
\t\tCapabilities: 0x0963
\tHT operation:
\t\t * primary channel: 6`;

        const result = parseIwScanDump(output);

        expect(result.size).toBe(1);
        expect(result.get('00:11:22:33:44:55')).toBe(WIFI_GENERATIONS.WIFI_4);
    });

    it('should return UNKNOWN for BSS without any capabilities', () => {
        const output = `BSS ff:ee:dd:cc:bb:aa(on wlan0)
\tfreq: 2412
\tsignal: -80.00 dBm
\tSSID: LegacyAP`;

        const result = parseIwScanDump(output);

        expect(result.size).toBe(1);
        expect(result.get('ff:ee:dd:cc:bb:aa')).toBe(WIFI_GENERATIONS.UNKNOWN);
    });

    it('should parse multiple BSS blocks', () => {
        const output = `BSS aa:bb:cc:dd:ee:01(on wlan0)
\tfreq: 5180
\tSSID: FastNetwork
\tHT capabilities:
\t\tCapabilities: 0x0963
\tVHT capabilities:
\t\tVHT Capabilities (0x338b79b2):
\tHE capabilities:
\t\tHE MAC Capabilities (0x000801185018):
BSS aa:bb:cc:dd:ee:02(on wlan0)
\tfreq: 2437
\tSSID: SlowNetwork
\tHT capabilities:
\t\tCapabilities: 0x0963
BSS aa:bb:cc:dd:ee:03(on wlan0)
\tfreq: 2412
\tSSID: LegacyNetwork`;

        const result = parseIwScanDump(output);

        expect(result.size).toBe(3);
        expect(result.get('aa:bb:cc:dd:ee:01')).toBe(WIFI_GENERATIONS.WIFI_6);
        expect(result.get('aa:bb:cc:dd:ee:02')).toBe(WIFI_GENERATIONS.WIFI_4);
        expect(result.get('aa:bb:cc:dd:ee:03')).toBe(WIFI_GENERATIONS.UNKNOWN);
    });

    it('should normalize BSSID to lowercase', () => {
        const output = `BSS AA:BB:CC:DD:EE:FF(on wlan0)
\tfreq: 5180
\tSSID: UpperCaseNetwork
\tHE capabilities:
\t\tHE MAC Capabilities (0x000801185018):`;

        const result = parseIwScanDump(output);

        expect(result.get('aa:bb:cc:dd:ee:ff')).toBe(WIFI_GENERATIONS.WIFI_6);
    });

    it('should pick the highest generation when multiple capabilities present', () => {
        const output = `BSS aa:bb:cc:dd:ee:ff(on wlan0)
\tfreq: 5220
\tSSID: DualCapNetwork
\tHT capabilities:
\t\tCapabilities: 0x0963
\tHT operation:
\t\t * primary channel: 44
\tVHT capabilities:
\t\tVHT Capabilities (0x338b79b2):
\tHE capabilities:
\t\tHE MAC Capabilities (0x000801185018):`;

        const result = parseIwScanDump(output);

        expect(result.get('aa:bb:cc:dd:ee:ff')).toBe(WIFI_GENERATIONS.WIFI_6);
    });

    it('should detect WiFi 5 via VHT operation without VHT capabilities', () => {
        const output = `BSS aa:bb:cc:dd:ee:ff(on wlan0)
\tfreq: 5180
\tSSID: VhtOpOnly
\tHT capabilities:
\t\tCapabilities: 0x0963
\tVHT operation:
\t\t * channel width: 1 (80 MHz)`;

        const result = parseIwScanDump(output);

        expect(result.get('aa:bb:cc:dd:ee:ff')).toBe(WIFI_GENERATIONS.WIFI_5);
    });

    it('should detect WiFi 4 via HT operation without HT capabilities', () => {
        const output = `BSS aa:bb:cc:dd:ee:ff(on wlan0)
\tfreq: 2437
\tSSID: HtOpOnly
\tHT operation:
\t\t * primary channel: 6`;

        const result = parseIwScanDump(output);

        expect(result.get('aa:bb:cc:dd:ee:ff')).toBe(WIFI_GENERATIONS.WIFI_4);
    });
});

describe('getSignalQualityFromPercent', () => {
    it('should return Poor for 0%', () => {
        expect(getSignalQualityFromPercent(asSignalPercent(0))).toBe('Poor');
    });

    it('should return Poor for 19%', () => {
        expect(getSignalQualityFromPercent(asSignalPercent(19))).toBe('Poor');
    });

    it('should return Weak for 20%', () => {
        expect(getSignalQualityFromPercent(asSignalPercent(20))).toBe('Weak');
    });

    it('should return Fair for 40%', () => {
        expect(getSignalQualityFromPercent(asSignalPercent(40))).toBe('Fair');
    });

    it('should return Fair for 59%', () => {
        expect(getSignalQualityFromPercent(asSignalPercent(59))).toBe('Fair');
    });

    it('should return Good for 60%', () => {
        expect(getSignalQualityFromPercent(asSignalPercent(60))).toBe('Good');
    });

    it('should return Excellent for 80%', () => {
        expect(getSignalQualityFromPercent(asSignalPercent(80))).toBe('Excellent');
    });

    it('should return Excellent for 100%', () => {
        expect(getSignalQualityFromPercent(asSignalPercent(100))).toBe('Excellent');
    });
});

describe('getSpeedQuality', () => {
    it('should return Poor for 0 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(0))).toBe('Poor');
    });

    it('should return Poor for 19 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(19))).toBe('Poor');
    });

    it('should return Weak for 20 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(20))).toBe('Weak');
    });

    it('should return Weak for 49 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(49))).toBe('Weak');
    });

    it('should return OK for 50 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(50))).toBe('OK');
    });

    it('should return OK for 99 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(99))).toBe('OK');
    });

    it('should return Good for 100 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(100))).toBe('Good');
    });

    it('should return Good for 299 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(299))).toBe('Good');
    });

    it('should return VeryGood for 300 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(300))).toBe('VeryGood');
    });

    it('should return VeryGood for 999 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(999))).toBe('VeryGood');
    });

    it('should return Excellent for 1000 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(1000))).toBe('Excellent');
    });

    it('should return Excellent for 2400 Mbit/s', () => {
        expect(getSpeedQuality(asBitrateMbps(2400))).toBe('Excellent');
    });
});
