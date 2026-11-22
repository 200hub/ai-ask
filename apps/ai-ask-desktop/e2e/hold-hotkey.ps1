$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TestHotkey {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnregisterHotKey(IntPtr window, int id);
}
'@

# Ctrl+Alt+Shift+F9, chosen to avoid the installed application's default shortcuts.
if (-not [TestHotkey]::RegisterHotKey([IntPtr]::Zero, 1, 7, 0x78)) {
    throw 'Could not acquire the external test hotkey.'
}
try {
    [Console]::WriteLine('registered')
    [void][Console]::ReadLine()
}
finally {
    [void][TestHotkey]::UnregisterHotKey([IntPtr]::Zero, 1)
}
