# Suivi de dwm pendant que l'utilisateur dessine dans Hexa.
# Mesure toutes les ~0,8 s pendant $Minutes, puis affiche un bilan par tranche de 30 s
# avec le nombre d'actions Hexa (journal) et les fenêtres Hexa visibles.
param([int]$Minutes = 3)

Add-Type @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public class SuiviFen { delegate bool P(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(P p, IntPtr l);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 public static int Visibles(uint[] pids){ int n=0; var s=new HashSet<uint>(pids); EnumWindows((h,l)=>{ uint pid; GetWindowThreadProcessId(h,out pid); if(s.Contains(pid) && IsWindowVisible(h)) n++; return true; }, IntPtr.Zero); return n; } }
'@

$mesures = @()
$fin = (Get-Date).AddMinutes($Minutes)
while ((Get-Date) -lt $fin) {
    $r = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ? { $_.Name -eq 'dwm' -or $_.Name -like 'Hexa*' }
    $ids = @(Get-Process Hexa -EA 0).Id
    $mesures += [pscustomobject]@{
        T    = Get-Date
        Dwm  = [double]($r | ? { $_.Name -eq 'dwm' }).PercentProcessorTime
        Hexa = [double](($r | ? { $_.Name -like 'Hexa*' } | measure PercentProcessorTime -Sum).Sum)
        Fen  = if ($ids) { [SuiviFen]::Visibles([uint32[]]$ids) } else { -1 }
    }
    Start-Sleep -Milliseconds 800
}

$journal = Get-Content "$env:APPDATA\Hexa\hexa.log" -Encoding UTF8 -Tail 4000 |
    Select-String -Pattern '^(\d\d:\d\d:\d\d).*action syst.me jou.e' |
    % { $_.Matches[0].Groups[1].Value }

$mesures | group { $_.T.ToString('HH:mm:') + ([int][math]::Floor($_.T.Second / 30) * 30).ToString('00') } | % {
    $g = $_.Group
    $debut = $g[0].T.ToString('HH:mm:ss'); $finT = $g[-1].T.ToString('HH:mm:ss')
    $actions = @($journal | ? { $_ -ge $debut -and $_ -le $finT }).Count
    "{0}  dwm moy {1,4:N0} max {2,3} | sature {3}/{4} | Hexa {5,3:N0} | fenetres Hexa {6} | traits {7}" -f $_.Name,
        ($g | measure Dwm -Average).Average, ($g | measure Dwm -Maximum).Maximum,
        @($g | ? { $_.Dwm -ge 80 }).Count, $g.Count,
        ($g | measure Hexa -Average).Average, ($g | measure Fen -Maximum).Maximum, $actions
}
