# garde_dwm.ps1 - watchdog dwm.exe (lecture seule : aucune touche envoyee, aucun controle OBS)
# ASCII-only on purpose (PS 5.1 reads BOM-less files as ANSI); accents are built with [char].
#
# Usage live :   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File garde_dwm.ps1
# Dry-run    :   powershell -NoProfile -ExecutionPolicy Bypass -File garde_dwm.ps1 -DryRun -Threshold 5 -DurationSec 60
# Test popup :   powershell -NoProfile -ExecutionPolicy Bypass -File garde_dwm.ps1 -TestPopup
# Stop       :   Ctrl+C in its window (or close the window).
[CmdletBinding()]
param(
    [double]$Threshold    = 80,     # dwm % (100 = one full core, same scale as Task Manager "details" x cores)
    [int]   $WindowSec    = 60,     # sliding window
    [int]   $HitSec       = 45,     # seconds >= Threshold inside the window to trigger
    [int]   $IntervalSec  = 2,      # sampling period
    [double]$CooldownMin  = 10,     # minimum minutes between two alerts
    [int]   $DurationSec  = 0,      # 0 = run forever
    [ValidateSet('Native','Cim')]
    [string]$Method       = 'Native', # Native = kernel process times (no WMI, cheapest) ; Cim = Win32_PerfFormattedData_PerfProc_Process (auto-fallback)
    [ValidateSet('MessageBox','Toast','Both')]
    [string]$Alert        = 'MessageBox',
    [switch]$Sound,                 # off by default: a system sound could reach the stream if desktop audio is captured
    [switch]$DryRun,                # print only, never any popup
    [switch]$TestPopup,             # show the alert once and exit
    [string]$TriggerFile  = '',     # optional: on alert, write a timestamp here (an Advanced Scene Switcher "Fichier" macro can watch it). Off by default.
    [string]$LogPath      = (Join-Path $PSScriptRoot 'garde_dwm_log.csv')
)

$ErrorActionPreference = 'Continue'
$e  = [char]0x00E9; $eg = [char]0x00E8; $lq = [char]0x00AB; $rq = [char]0x00BB
$Title = 'Garde dwm - stream'
$Msg   = "$lq dwm satur$e : change de sc${eg}ne OBS 2 secondes puis reviens $rq"

# ---------- alert (non-blocking, in its own STA runspace; no new process) ----------
$script:popupPs = $null
function Show-Alert([string]$detail) {
    $text = "$Msg`r`n`r`n$detail"
    if ($Alert -in 'Toast','Both') {
        try {
            [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
            [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
            $x = New-Object Windows.Data.Xml.Dom.XmlDocument
            $sec = [Security.SecurityElement]
            $x.LoadXml("<toast scenario='urgent'><visual><binding template='ToastGeneric'><text>$($sec::Escape($Title))</text><text>$($sec::Escape($Msg))</text></binding></visual></toast>")
            $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($x))
        } catch { Write-Warning "Toast failed: $_" }
    }
    if ($Alert -in 'MessageBox','Both') {
        if ($script:popupPs -and -not $script:popupPs.InvocationStateInfo.State.ToString().Equals('Completed')) { return } # one box at a time
        $rs = [runspacefactory]::CreateRunspace(); $rs.ApartmentState = 'STA'; $rs.Open()
        $ps = [powershell]::Create(); $ps.Runspace = $rs
        [void]$ps.AddScript({
            param($t, $c, $snd)
            if ($snd) { [System.Media.SystemSounds]::Exclamation.Play() }
            # 0x30 = warning icon, 0x40000 = MB_TOPMOST ; auto-closes after 120 s
            [void](New-Object -ComObject WScript.Shell).Popup($t, 120, $c, 0x30 + 0x40000)
        }).AddArgument($text).AddArgument($Title).AddArgument([bool]$Sound)
        [void]$ps.BeginInvoke()
        $script:popupPs = $ps
    }
}

if ($TestPopup) { Show-Alert '(test)'; Start-Sleep -Seconds 3; while ($script:popupPs.InvocationStateInfo.State -eq 'Running') { Start-Sleep -Milliseconds 500 }; return }

# ---------- single instance ----------
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\garde_dwm_watchdog', [ref]$created)
if (-not $created) { Write-Host 'garde_dwm already running - exiting.'; return }

try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}

# ---------- sampler ----------
$cpuCount = [Environment]::ProcessorCount
# Native = NtQuerySystemInformation(SystemProcessInformation): same source as Task Manager, works
# non-elevated for dwm (Process.TotalProcessorTime is access-denied on dwm), no WMI at all.
if ($Method -eq 'Native') {
    if ([IntPtr]::Size -ne 8) { Write-Warning 'Native needs 64-bit PowerShell - falling back to Cim'; $Method = 'Cim' }
    else {
        try {
            if (-not ('GardeDwm.ProcTimes' -as [type])) {
                Add-Type -ErrorAction Stop -TypeDefinition @'
using System; using System.Runtime.InteropServices;
namespace GardeDwm { public static class ProcTimes {
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int c, IntPtr b, int l, out int r);
  static IntPtr buf = IntPtr.Zero; static int len = 0;
  // returns summed User+Kernel time (100 ns units) for each image name, -1 if not found
  public static long[] Get(string[] names) {
    if (buf == IntPtr.Zero) { len = 1 << 20; buf = Marshal.AllocHGlobal(len); }
    int ret, st;
    while ((st = NtQuerySystemInformation(5, buf, len, out ret)) == unchecked((int)0xC0000004)) {
      Marshal.FreeHGlobal(buf); len = Math.Max(len * 2, ret + 65536); buf = Marshal.AllocHGlobal(len); }
    if (st != 0) return null;
    long[] res = new long[names.Length]; for (int i = 0; i < res.Length; i++) res[i] = -1;
    long off = 0;
    while (true) {
      IntPtr p = new IntPtr(buf.ToInt64() + off);
      int next = Marshal.ReadInt32(p, 0);
      ushort nl = (ushort)Marshal.ReadInt16(p, 56); IntPtr nb = Marshal.ReadIntPtr(p, 64);
      if (nb != IntPtr.Zero && nl > 0) {
        string n = Marshal.PtrToStringUni(nb, nl / 2);
        for (int i = 0; i < names.Length; i++)
          if (string.Equals(n, names[i], StringComparison.OrdinalIgnoreCase)) {
            if (res[i] < 0) res[i] = 0; res[i] += Marshal.ReadInt64(p, 40) + Marshal.ReadInt64(p, 48); } }
      if (next == 0) break; off += next; }
    return res; } } }
'@
            }
            $t = [GardeDwm.ProcTimes]::Get([string[]]@('dwm.exe'))
            if (-not $t -or $t[0] -le 0) { throw 'dwm.exe not seen' }
        } catch { Write-Warning "Native sampler unavailable ($_) - falling back to Cim"; $Method = 'Cim' }
    }
}
$cim = if ($Method -eq 'Cim') { New-CimSession } else { $null }  # reused session
$prevT = $null; $prevTs = 0
function Get-Sample {
    if ($Method -eq 'Cim') {
        $r = Get-CimInstance -CimSession $cim -ClassName Win32_PerfFormattedData_PerfProc_Process `
             -Filter "Name='dwm' OR Name='obs64'" -Property Name, PercentProcessorTime -ErrorAction SilentlyContinue
        $d = -1; $o = -1
        foreach ($x in $r) { if ($x.Name -eq 'dwm') { $d = [double]$x.PercentProcessorTime } elseif ($x.Name -eq 'obs64') { $o = [double]$x.PercentProcessorTime } }
        return @($d, $o)
    } else {
        $now = [Diagnostics.Stopwatch]::GetTimestamp()
        $t = [GardeDwm.ProcTimes]::Get([string[]]@('dwm.exe','obs64.exe'))
        $out = @(-1, -1)
        if ($t -and $prevT) {
            $dt100ns = ($now - $prevTs) * 1e7 / [Diagnostics.Stopwatch]::Frequency
            for ($i = 0; $i -lt 2; $i++) {
                if ($t[$i] -ge 0 -and $prevT[$i] -ge 0 -and $t[$i] -ge $prevT[$i]) { $out[$i] = [math]::Round(100.0 * ($t[$i] - $prevT[$i]) / $dt100ns, 1) }
            }
        }
        $script:prevT = $t; $script:prevTs = $now
        return $out
    }
}

function Get-WmiCpuMs { $t = 0.0; foreach ($r in (Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter "Name LIKE 'WmiPrvSE%'" -Property Name,PercentProcessorTime -ErrorAction SilentlyContinue)) { $t += [double]$r.PercentProcessorTime / 10000.0 }; $t }  # raw = 100ns units

# ---------- log ----------
if (-not (Test-Path $LogPath)) { [IO.File]::WriteAllText($LogPath, "time;dwm_pct;obs64_pct;hits_s_in_window;state;event`r`n") }
$buf = New-Object Text.StringBuilder
function Flush-Log { if ($buf.Length) { try { [IO.File]::AppendAllText($LogPath, $buf.ToString()) } catch {} ; [void]$buf.Clear() } }

$need     = [math]::Ceiling($WindowSec / $IntervalSec)
$hist     = New-Object 'System.Collections.Generic.Queue[double]'
$lastAlert = [datetime]::MinValue
$self0    = (Get-Process -Id $PID).TotalProcessorTime
$wmi0     = Get-WmiCpuMs
$sw       = [Diagnostics.Stopwatch]::StartNew()
$selfLoop0 = $null
$n = 0; $alerts = 0; $maxDwm = 0
Write-Host ("garde_dwm started {0}  method={1} threshold={2}% hits>={3}s/{4}s interval={5}s cooldown={6}min dryrun={7}  log={8}" -f (Get-Date), $Method, $Threshold, $HitSec, $WindowSec, $IntervalSec, $CooldownMin, [bool]$DryRun, $LogPath)
[void]$buf.AppendLine("$(Get-Date -Format s);;;;start;method=$Method thr=$Threshold dry=$([bool]$DryRun)")

try {
    while ($true) {
        $tick = $sw.ElapsedMilliseconds
        $s = Get-Sample; $dwm = $s[0]; $obs = $s[1]; $n++
        if ($n -eq 2) { $selfLoop0 = (Get-Process -Id $PID).TotalProcessorTime; $loopT0 = $sw.Elapsed }
        if ($dwm -ge 0) {
            if ($dwm -gt $maxDwm) { $maxDwm = $dwm }
            $hist.Enqueue($dwm); while ($hist.Count -gt $need) { [void]$hist.Dequeue() }
        }
        $hits = 0; foreach ($v in $hist) { if ($v -ge $Threshold) { $hits++ } }
        $hitS = $hits * $IntervalSec
        $now = Get-Date
        $inCooldown = ($now - $lastAlert).TotalMinutes -lt $CooldownMin
        $state = if ($hitS -ge $HitSec) { if ($inCooldown) { 'saturated-cooldown' } else { 'ALERT' } } elseif ($dwm -ge $Threshold) { 'high' } else { 'ok' }
        $evt = ''
        if ($state -eq 'ALERT') {
            $lastAlert = $now; $alerts++
            $detail = "dwm={0}% ({1}s >= {2}% sur {3}s) - {4:HH:mm:ss}" -f $dwm, $hitS, $Threshold, $WindowSec, $now
            if ($DryRun) { $evt = 'would-alert(dry-run)'; Write-Host "[DRY-RUN] ALERT would fire: $Msg | $detail" -ForegroundColor Yellow }
            else         { $evt = 'alert-shown'; Show-Alert $detail; Write-Host "ALERT $detail" -ForegroundColor Red
                           if ($TriggerFile) { try { [IO.File]::WriteAllText($TriggerFile, ("{0:s}" -f $now)); $evt += '+trigger-file' } catch { Write-Warning "trigger file: $_" } } }
        }
        $line = "{0:s};{1};{2};{3};{4};{5}" -f $now, $dwm, $obs, $hitS, $state, $evt
        [void]$buf.AppendLine($line)
        if ($DryRun) { Write-Host $line }
        if ($n % 15 -eq 0 -or $evt) { Flush-Log }
        if ($DurationSec -gt 0 -and $sw.Elapsed.TotalSeconds -ge $DurationSec) { break }
        $sleep = $IntervalSec * 1000 - ($sw.ElapsedMilliseconds - $tick)
        if ($sleep -gt 0) { Start-Sleep -Milliseconds $sleep }
    }
}
finally {
    $p = Get-Process -Id $PID
    $selfAll = ($p.TotalProcessorTime - $self0).TotalMilliseconds
    $el = $sw.Elapsed.TotalMilliseconds
    $wmi1 = Get-WmiCpuMs
    $loopPct = if ($selfLoop0) { 100.0 * ($p.TotalProcessorTime - $selfLoop0).TotalMilliseconds / ($sw.Elapsed - $loopT0).TotalMilliseconds } else { -1 }
    $summary = "samples={0} alerts={1} maxDwm={2}% | self CPU: {3:N3}% of one core ({4:N3}% of total {5} logical CPUs), steady-loop {6:N3}% of one core | WmiPrvSE delta during run (all WMI clients): {7:N3}% of one core | WS={8:N0} MB" -f `
        $n, $alerts, $maxDwm, (100.0*$selfAll/$el), (100.0*$selfAll/$el/$cpuCount), $cpuCount, $loopPct, (100.0*($wmi1-$wmi0)/$el), ($p.WorkingSet64/1MB)
    Write-Host $summary -ForegroundColor Cyan
    [void]$buf.AppendLine("$(Get-Date -Format s);;;;stop;$summary"); Flush-Log
    if ($cim) { Remove-CimSession $cim }
    $mutex.ReleaseMutex(); $mutex.Dispose()
}
