# test-data — fixture corpus

Fixtures every parallel Phase-1 track codes against. **Provenance matters** for
compatibility work, so each file is tagged REAL (produced by SayMore/ELAN) or
SYNTHESIZED (hand-authored to SayMore/ELAN conventions for this project).

## Files

| Path                                        | Origin                                                                                      | Purpose                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `annotationTemplate.etf`                    | **REAL** — copied verbatim from `D:\saymore\DistFiles\annotationTemplate.etf`               | Seed for new `.annotations.eaf` files (EafDocument.createEafFromTemplate).                                                                                                                                                                                  |
| `real-eaf/test.eaf`                         | **REAL** — from SayMore's own test suite (`D:\saymore\src\SayMoreTests\Resources\test.eaf`) | Golden EAF for round-trip specs. Note: **non-sequential** annotation ids (`a1, a3, a2`), `lastUsedAnnotationId=7`, and a **foreign tier** (`User Defined Tier`) that a DOM-preserving save must keep.                                                       |
| `media/shortSound.wav`                      | **REAL** — SayMore test resources                                                           | Small real WAV (mono, 22 kHz, 16-bit, 1.450 s) for envelope/thumbnail/header specs.                                                                                                                                                                         |
| `media/longerSound.wav`                     | **REAL** — SayMore test resources                                                           | Longer real WAV (mono, 44.1 kHz, 16-bit, 56.775 s) for realistic envelope + waveform.                                                                                                                                                                       |
| `session/longerSound.wav`                   | **REAL** (same bytes as `media/longerSound.wav`)                                            | The media of the session-folder fixture.                                                                                                                                                                                                                    |
| `session/longerSound.wav.annotations.eaf`   | **SYNTHESIZED** to SayMore convention                                                       | 3 positional segments: careful-only, careful+translation, and an `%ignore%` segment. Time slots in integer ms; separate coincident slots for adjacent boundaries (mirrors real SayMore output).                                                             |
| `session/longerSound.wav_Annotations/*.wav` | **SYNTHESIZED** names, REAL WAV bytes (copies of `shortSound.wav`)                          | Oral-annotation clips. Filenames use **authentic net48 C#-float tokens** (see below): `0.75_to_1.25_Careful.wav`, `1.25_to_2.121_Careful.wav`, `1.25_to_2.121_Translation.wav`. Folder name is `<media-with-ext>_Annotations` (verified `TimeTier.cs:160`). |
| `elan-authored/regular-annotations.eaf`     | **SYNTHESIZED** to ELAN convention                                                          | ELAN "regular annotations": interior `TIME_SLOT`s omit `TIME_VALUE` (interpolate 0→4000 ⇒ 1333, 2667) + a foreign tier (`Notes`) that must survive save.                                                                                                    |
| `csfloat/csfloat-parity.json`               | **GENERATED** by `GenerateParityTable.cs` on **net48**                                      | Ground-truth table for `csFloat.ts`.                                                                                                                                                                                                                        |
| `csfloat/GenerateParityTable.cs`            | throwaway generator (kept for reproducibility)                                              | See build command below.                                                                                                                                                                                                                                    |

## ⚠️ Gap: no genuine oral-annotation session was found on disk

A disk-wide search turned up **no** real SayMore-produced session folder with an
`_Annotations/` folder of recorded WAVs (no `.sprj`, no other `.annotations.eaf`).
The `session/` fixture is therefore **faithfully reconstructed** from SayMore
conventions, not captured from a real recording session. It is correct for
parsing/naming/round-trip work. **Before the Phase-1 F1/F3 manual compat gates**,
drop in one genuine session recorded in SayMore (media + `.annotations.eaf` +
real careful/translation WAVs) and reopen the edited result in SayMore **and**
ELAN, per the plan's verification steps.

## C#-float filename parity (top compatibility risk)

SayMore targets **.NET Framework 4.8** and names oral-annotation WAVs with
`string.Format("{0}_to_{1}{2}", (float)startSec, (float)endSec, suffix)` under the
**current culture** (`TimeTier.cs:123-134`). net48's default `Single.ToString()`
emits **≈7 significant digits** (legacy "shortest within G7"), which differs from
.NET Core / modern browsers' shortest-round-trippable output. `csfloat-parity.json`
was generated on net48 and is the authority.

**Correction for the F3 track:** the plan sketches `csFloat.ts` as "`Math.fround` +
shortest `toPrecision(1..9)` that round-trips to the same float32." That yields the
_modern_ shortest string, which is **wrong** for some values. Example from the
table: `1/3` → float32 `0.333333343`; net48 writes **`0.3333333`**, but the
shortest-round-trip rule gives `0.33333334`. The correct rule is **round the
float32 to 7 significant figures, then trim trailing zeros / the decimal point**
(integers get no decimal, e.g. `10` and `3600`). Validate `csFloat.ts` against
every row of `csfloat-parity.json`. The `deDE` column (comma decimals) exists to
exercise the scanner's read-tolerance; the tool always _writes_ the `invariant`
(`.`) form.

### Regenerate the parity table

Compile with the **.NET Framework** compiler (so it runs on net48) and run:

```sh
CSC="/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
"$CSC" -nologo -out:GenerateParityTable.exe GenerateParityTable.cs
./GenerateParityTable.exe "$(pwd -W)/csfloat-parity.json"
rm GenerateParityTable.exe   # do not commit the binary
```
