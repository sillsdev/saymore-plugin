// Throwaway generator for the C#-float filename parity fixture.
//
// SayMore targets .NET Framework 4.8 (net48) and formats oral-annotation WAV
// filenames with:  string.Format("{0}_to_{1}{2}", (float)start, (float)end, suffix)
// using the CURRENT culture (TimeTier.cs:123-134). .NET Framework's default
// Single.ToString() differs from .NET Core's shortest-round-trippable output for
// some values (e.g. 1f/3f -> "0.3333333" on net48 vs "0.33333334" on Core), so
// this MUST be compiled with the Framework C# compiler and run on net48 to be
// faithful. See test-data/README.md for the build command.
//
// Output: csfloat-parity.json — for each representative segment-boundary value,
// the exact float32 (as input double, round-tripped value, and raw int32 bits)
// plus the string SayMore would write under InvariantCulture (canonical, what
// our csFloat.ts always writes) and under a comma-decimal culture (de-DE, which
// our scanner must tolerate on read).

using System;
using System.Globalization;
using System.IO;
using System.Text;

class GenerateParityTable
{
    static readonly double[] Inputs = new double[]
    {
        0.0,
        0.001,        // 1 ms
        0.46,         // min segment length (460 ms)
        0.1,
        0.2,
        0.3,
        0.75,         // test.eaf ts2
        1.25,         // test.eaf ts4/ts5
        1.0,
        2.121,        // test.eaf ts6
        2.5,
        1.0 / 3.0,    // 0.33333334f -> net48 "0.3333333"
        2.0 / 3.0,    // 0.6666667f
        3.1415927,
        7.89,
        10.0,
        12.3456789,
        100.12345,
        123.456,
        1234.5678,
        3600.0,       // one hour
        5999.999      // near the top of a long file
    };

    static string Fmt(float value, CultureInfo culture)
    {
        return string.Format(culture, "{0}", value);
    }

    static void Main()
    {
        var invariant = CultureInfo.InvariantCulture;
        var comma = CultureInfo.GetCultureInfo("de-DE");
        var sb = new StringBuilder();
        sb.Append("{\n");
        sb.Append("  \"description\": \"C# net48 float32 filename-formatting parity table for csFloat.ts. 'invariant' is the canonical token our tool writes; 'deDE' is a comma-decimal sample our scanner must read.\",\n");
        sb.Append("  \"suffixes\": { \"careful\": \"_Careful.wav\", \"translation\": \"_Translation.wav\", \"folder\": \"_Annotations\" },\n");
        sb.Append("  \"entries\": [\n");
        for (int i = 0; i < Inputs.Length; i++)
        {
            double d = Inputs[i];
            float f = (float)d;
            int bits = BitConverter.ToInt32(BitConverter.GetBytes(f), 0);
            sb.Append("    {");
            sb.AppendFormat(invariant, "\"input\": {0}, ", d.ToString("R", invariant));
            sb.AppendFormat(invariant, "\"float32RoundTrip\": {0}, ", f.ToString("R", invariant));
            sb.AppendFormat(invariant, "\"float32Bits\": {0}, ", bits);
            sb.Append("\"invariant\": \"" + Fmt(f, invariant) + "\", ");
            sb.Append("\"deDE\": \"" + Fmt(f, comma) + "\"");
            sb.Append(i == Inputs.Length - 1 ? "}\n" : "},\n");
        }
        sb.Append("  ]\n");
        sb.Append("}\n");

        string outPath = Path.Combine(
            Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location),
            "csfloat-parity.json");
        // When run from the exe location; but we pass the target explicitly via arg if given.
        var args = Environment.GetCommandLineArgs();
        if (args.Length > 1) outPath = args[1];
        File.WriteAllText(outPath, sb.ToString(), new UTF8Encoding(false));
        Console.WriteLine("Wrote " + outPath);
        Console.WriteLine("Runtime: " + Environment.Version + " (compiled for net48)");
        Console.Write(sb.ToString());
    }
}
