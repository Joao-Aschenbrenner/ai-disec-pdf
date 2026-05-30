namespace SeparadorDePdf.Ocr;

public static class TesseractLanguage
{
    public const string Portuguese = "por";
    public const string English = "eng";
    public const string PortugueseAndEnglish = "por+eng";
    public static string Default => PortugueseAndEnglish;
    public static string[] DefaultArray => new[] { Portuguese, English };
}
