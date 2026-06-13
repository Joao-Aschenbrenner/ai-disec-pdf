using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IGroupDetector
{
    int CalculateScore(PageResult previous, PageResult current);
    bool ShouldGroup(PageResult previous, PageResult current);
    List<DocumentGroup> DetectGroups(List<PageResult> pages);
}
