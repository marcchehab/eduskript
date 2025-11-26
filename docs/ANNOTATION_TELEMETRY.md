# Annotation System Telemetry Analysis

*Last updated: 2025-11-26*

## Overview

This document tracks stroke telemetry data collected from different devices to understand drawing performance characteristics and optimize the annotation experience.

## Metrics Collected

| Metric | Description |
|--------|-------------|
| `pointCount` | Total raw points captured in stroke |
| `totalLengthPx` | Total stroke length in pixels |
| `lengthPerPoint` | Average distance between consecutive points (px) |
| `durationMs` | Total stroke duration in milliseconds |
| `durationPerPoint` | Time between consecutive points (ms) = sampling interval |
| `device` | iOS / Android / Desktop |
| `pointerType` | pen / touch / mouse |

### Interpreting the Metrics

- **Lower `durationPerPoint`** = higher sampling rate = smoother strokes
- **Lower `lengthPerPoint`** = denser point spacing = less visible choppiness
- **Sampling rate (Hz)** ≈ 1000 / durationPerPoint

---

## Device Test Results

### Linux Desktop + Huion Kamvas Pro 19 (Firefox 145)

**Test Date:** 2025-11-26

| Metric | Typical Value | Notes |
|--------|---------------|-------|
| `durationPerPoint` | **~4.3ms** | Excellent - ~230 Hz sampling |
| `lengthPerPoint` | **~1.3-1.9px** | Very dense point spacing |
| `pointerType` | `pen` | Hardware stylus detected |

**Assessment:** Exceptional drawing experience. The Huion tablet provides ~230 samples/second with points only 1-2 pixels apart. Feels "like paper" with zero perceptible lag.

**Sample Strokes:**
```
pointCount: 239, lengthPerPoint: 1.30px, durationPerPoint: 4.16ms (~240Hz)
pointCount: 116, lengthPerPoint: 1.28px, durationPerPoint: 4.31ms (~232Hz)
pointCount: 319, lengthPerPoint: 1.25px, durationPerPoint: 4.42ms (~226Hz)
pointCount: 87,  lengthPerPoint: 1.09px, durationPerPoint: 4.36ms (~229Hz)
```

---

### Lenovo Yoga 7i + Built-in Stylus (Linux/Firefox)

**Test Date:** 2025-11-26
**Hardware:** Lenovo Yoga 7i 2-in-1 with integrated pen

| Metric | Typical Value | Notes |
|--------|---------------|-------|
| `durationPerPoint` | **~4.0-4.5ms** | Excellent - ~220-250 Hz sampling |
| `lengthPerPoint` | **~0.7-1.5px** | Very dense, consistent spacing |
| `pointerType` | `pen` | Hardware stylus detected |

**Assessment:** Feels great! Very consistent sampling rate and dense point spacing. Built-in digitizer provides excellent low-jitter input.

**Sample Strokes:**
```
pointCount: 253, lengthPerPoint: 1.55px, durationPerPoint: 3.98ms (~251Hz)
pointCount: 244, lengthPerPoint: 1.46px, durationPerPoint: 4.22ms (~237Hz)
pointCount: 179, lengthPerPoint: 1.47px, durationPerPoint: 4.22ms (~237Hz)
pointCount: 146, lengthPerPoint: 1.10px, durationPerPoint: 3.77ms (~265Hz)
pointCount: 116, lengthPerPoint: 1.03px, durationPerPoint: 4.12ms (~243Hz)
```

---

### Lenovo Tab T8 Android Tablet (Chrome)

**Test Date:** 2025-11-26
**Hardware:** Lenovo Tab T8 Android tablet with stylus

| Metric | Typical Value | Notes |
|--------|---------------|-------|
| `durationPerPoint` | **~17-25ms** | Poor - only ~40-60 Hz sampling |
| `lengthPerPoint` | **~3-7px** | Very sparse, visible gaps |
| `pointerType` | `pen` | Hardware stylus detected |

**Assessment:** Clearly the worst experience. The tablet's digitizer samples at only ~40-60 Hz (5-6x slower than other devices), creating obvious gaps between points and laggy response.

**Sample Strokes:**
```
pointCount: 34, lengthPerPoint: 4.88px, durationPerPoint: 17.36ms (~58Hz)
pointCount: 27, lengthPerPoint: 3.70px, durationPerPoint: 21.62ms (~46Hz)
pointCount: 25, lengthPerPoint: 4.88px, durationPerPoint: 18.54ms (~54Hz)
pointCount: 22, lengthPerPoint: 5.27px, durationPerPoint: 20.48ms (~49Hz)
pointCount: 13, lengthPerPoint: 6.12px, durationPerPoint: 24.25ms (~41Hz)
```

**Root Cause:** Hardware limitation - the tablet's digitizer simply doesn't sample fast enough. No software fix can overcome this; interpolation could help mask the gaps but adds latency.

---

### iPad + Third-Party Stylus (Safari)

**Test Date:** 2025-11-26
**Hardware:** iPad with non-Apple stylus

| Metric | Typical Value | Notes |
|--------|---------------|-------|
| `durationPerPoint` | **~2.4-4.6ms** | Excellent! ~220-420 Hz sampling |
| `lengthPerPoint` | **~0.4-4.0px** | Variable - depends on stroke speed |
| `pointerType` | `pen` | Hardware stylus detected |

**Assessment:** Surprisingly good metrics - sampling rate is comparable or even better than Desktop in some cases! Despite this, the user reports strokes feel "choppy" compared to Desktop.

**Sample Strokes:**
```
pointCount: 482, lengthPerPoint: 4.04px, durationPerPoint: 2.38ms (~420Hz)
pointCount: 309, lengthPerPoint: 1.12px, durationPerPoint: 3.34ms (~300Hz)
pointCount: 163, lengthPerPoint: 0.88px, durationPerPoint: 3.25ms (~308Hz)
pointCount: 155, lengthPerPoint: 0.85px, durationPerPoint: 2.99ms (~335Hz)
pointCount: 118, lengthPerPoint: 0.68px, durationPerPoint: 3.91ms (~256Hz)
```

**Mystery:** Numbers look great, but drawing feels worse. Possible explanations:
1. **Third-party stylus jitter** - Cheap pen may introduce wobble/noise not captured by these metrics
2. **Safari rendering pipeline** - May batch canvas updates differently than Firefox
3. **Display refresh rate** - iPad Pro has 120Hz, but Safari may not sync canvas updates
4. **Touch prediction** - iOS may have different touch prediction behavior

---

## Analysis & Recommendations

### Key Findings

1. **~200+ Hz sampling** is required for a good drawing experience
2. **Budget Android tablets** (~50 Hz) are hardware-limited - disregard for now
3. **iPad mystery**: High sampling but choppy feel → likely third-party stylus jitter

### Comparison Summary

| Device | Sampling Rate | Point Spacing | Feel |
|--------|--------------|---------------|------|
| Linux + Huion Kamvas Pro 19 | ~230 Hz | 1.0-1.9px | "Like paper" |
| Lenovo Yoga 7i (built-in pen) | ~220-250 Hz | 0.7-1.5px | "Feels great" |
| iPad + Third-party stylus | ~220-420 Hz | 0.4-4.0px | "Choppy" |
| Lenovo Tab T8 Android | **~40-60 Hz** | 3-7px | **"Horrible"** |

### Next Steps

1. **Add jitter metric** - Calculate standard deviation of point-to-point distances to quantify wobble
2. **Test with Apple Pencil** - Compare third-party vs official stylus on same iPad
3. ~~**Real-time smoothing**~~ ✅ Implemented with 3-point moving average

### Current Smoothing Strategy

**Real-time smoothing implemented** (2025-11-26):

- **During drawing:** 3-point moving average applied in real-time
- **Raw data preserved:** Original points stored for telemetry accuracy
- **After stroke:** Additional 3-point smoothing for final render
- **Configurable:** `REALTIME_SMOOTHING_WINDOW` constant in `simple-canvas.tsx`

**A/B Testing Results:**
| Window Size | Feel | Lag |
|-------------|------|-----|
| 1 (raw) | Most responsive, visible jitter | None |
| 2 (light) | Slightly smoother | Imperceptible |
| 3 (moderate) | **Smoothest, chosen as default** | Imperceptible |

**Implementation Details:**
- Optimized averaging function (no array allocation, direct index access)
- Separate tracking for smoothed render position vs. raw stored points
- Test mode available: `SMOOTHING_TEST_MODE = true` cycles through levels with colors

### Potential Future Improvements

1. **Noise threshold** - Ignore tiny movements (< 0.5px)
2. **Pressure smoothing** - Currently only position is smoothed, not pressure
3. **Adaptive smoothing** - Adjust window based on device detection

### Hardware Considerations

- **Apple Pencil (official)** - Hardware-level noise filtering + prediction
- **Third-party stylus** - May lack noise filtering, introducing visible jitter
- **Browser rendering** - Safari may have different canvas compositing behavior

---

## How to Run Tests

1. Enable annotation mode on any page
2. Draw several strokes (short, long, fast, slow)
3. View telemetry: `curl -s https://localhost:3000/api/debug -k | jq`
4. Clear reports: `curl -s -X DELETE https://localhost:3000/api/debug -k`

### Telemetry Code Location

- Telemetry collection: `src/components/annotations/simple-canvas.tsx` (stopDrawing function)
- Debug API: `src/app/api/debug/route.ts`
