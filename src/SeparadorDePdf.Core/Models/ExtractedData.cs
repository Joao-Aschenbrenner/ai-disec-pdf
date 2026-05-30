namespace SeparadorDePdf.Core.Models;

public class ExtractedData
{
    public Dictionary<string, string> Fields { get; set; } = new();

    public string? this[string key]
    {
        get => Fields.TryGetValue(key, out var value) ? value : null;
        set { if (value is not null) Fields[key] = value; }
    }

    public bool HasField(string key) => Fields.ContainsKey(key);
}
