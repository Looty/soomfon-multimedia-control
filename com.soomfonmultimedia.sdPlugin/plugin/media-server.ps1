# Persistent media-session worker, spawned ONCE by mediaServer.js and shared by
# every action instance. Talks to the Windows System Media Transport Controls
# (SMTC) -- the same per-app media sessions behind the Windows media overlay --
# so play/pause/previous/next go to ONE chosen app instead of being broadcast
# as a global media key (which hits the browser and anything else listening).
#
# Newline-delimited JSON protocol on stdin/stdout, one object per line:
#   in:  {"id":1,"op":"playpause","mode":"byname","processName":"Spotify.exe"}
#   out: {"id":1,"ok":true,"app":"Spotify.exe","status":"Playing"}
# ops: list | playpause | previous | next

$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ForegroundWin {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    public static int GetForegroundProcessId() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return (int)pid;
    }

    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    // VK_VOLUME_DOWN (0xAE) then VK_VOLUME_UP (0xAF): nets to no volume
    // change, but a real volume key makes the shell show its flyout (with the
    // media card). Down first so that at 100% (where up would clamp) it still
    // returns to the same level. Media-session calls alone bypass the shell,
    // so no flyout.
    public static void PokeFlyout() {
        const uint UP = 2, EXT = 1;
        keybd_event(0xAE, 0, EXT, UIntPtr.Zero);
        keybd_event(0xAE, 0, EXT | UP, UIntPtr.Zero);
        keybd_event(0xAF, 0, EXT, UIntPtr.Zero);
        keybd_event(0xAF, 0, EXT | UP, UIntPtr.Zero);
    }
}
'@ -ErrorAction Stop

# WinRT IAsyncOperation<T> -> .NET Task, so it can be waited on synchronously.
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, [Type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($op))
    $null = $task.Wait(4000)
    return $task.Result
}

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$manager = Await ($managerType::RequestAsync()) $managerType

function Strip-Exe([string]$name) {
    if ($name -match '\.exe$') { return $name.Substring(0, $name.Length - 4) }
    return $name
}

function Find-Session([string]$mode, [string]$processName) {
    $sessions = @($manager.GetSessions())
    if ($mode -eq 'foreground') {
        try { $want = (Get-Process -Id ([ForegroundWin]::GetForegroundProcessId())).ProcessName } catch { return $null }
    } else {
        $want = Strip-Exe $processName
    }
    if (-not $want) { return $null }
    # A session's source id is a process name ("Spotify.exe"), a browser name
    # ("Chrome"), or a packaged-app id ("Pkg_abc!App"). Exact match first;
    # the contains-match only matters for the foreground mode, where the
    # process name ("chrome") and session id ("Chrome") may differ in shape.
    foreach ($s in $sessions) {
        if ((Strip-Exe $s.SourceAppUserModelId) -ieq $want) { return $s }
    }
    if ($mode -eq 'foreground' -and $want.Length -ge 3) {
        foreach ($s in $sessions) {
            if ($s.SourceAppUserModelId -like "*$want*") { return $s }
        }
    }
    return $null
}

function Handle-Command($cmd) {
    $id = $cmd.id
    try {
        if ($cmd.op -eq 'list') {
            $names = @($manager.GetSessions() | ForEach-Object { $_.SourceAppUserModelId } | Sort-Object -Unique)
            return @{ id = $id; ok = $true; apps = $names }
        }
        $s = Find-Session $cmd.mode $cmd.processName
        if ($null -eq $s) { return @{ id = $id; ok = $false; reason = 'no-session' } }
        switch ($cmd.op) {
            'playpause' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
            'previous'  { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
            'next'      { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
            default     { return @{ id = $id; ok = $false; reason = 'unknown-op' } }
        }
        if ($cmd.flyout) { [ForegroundWin]::PokeFlyout() }
        $status = $s.GetPlaybackInfo().PlaybackStatus.ToString()
        return @{ id = $id; ok = $true; app = $s.SourceAppUserModelId; status = $status }
    } catch {
        return @{ id = $id; ok = $false; reason = 'error'; message = $_.Exception.Message }
    }
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break } # stdin closed -- host is shutting us down
    if ($line.Trim() -eq '') { continue }
    try {
        $cmd = $line | ConvertFrom-Json
    } catch {
        continue
    }
    $response = Handle-Command $cmd
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
