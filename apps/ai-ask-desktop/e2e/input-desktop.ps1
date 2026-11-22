param([switch] $Describe)

if (-not ('E2eInputDesktop' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class E2eInputDesktop {
    private const uint ReadObjects = 0x0001;
    private const int UserObjectName = 2;
    private const int UserObjectReceivesInput = 6;
    private const uint NearestToOrigin = 2;
    private const uint RootWindow = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")]
    private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ReadName(IntPtr desktop, int index, StringBuilder value, int bytes, out uint required);
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", SetLastError = true)]
    private static extern bool ReadFlag(IntPtr desktop, int index, out int value, int bytes, out uint required);

    private static bool IsLockWindow(IntPtr window) {
        var windowClass = new StringBuilder(64);
        if (GetClassName(window, windowClass, windowClass.Capacity) > 0
            && string.Equals(windowClass.ToString(), "LockScreenBackstopFrame", StringComparison.Ordinal)) return true;
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        if (processId == 0) return false;
        try {
            using (Process process = Process.GetProcessById((int)processId)) {
                return string.Equals(process.ProcessName, "LockApp", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(process.ProcessName, "LogonUI", StringComparison.OrdinalIgnoreCase);
            }
        } catch (ArgumentException) {
            // The window can exit between the two calls.
            return false;
        }
    }

    private static bool IsLockScreenShowing() {
        if (IsLockWindow(GetForegroundWindow())) return true;
        // Lock-screen notifications can own the foreground while LockApp still covers the desktop.
        var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
        if (!GetMonitorInfo(MonitorFromPoint(new Point(), NearestToOrigin), ref info)) return false;
        Rect r = info.Monitor;
        var center = new Point { X = r.Left + (r.Right - r.Left) / 2, Y = r.Top + (r.Bottom - r.Top) / 2 };
        IntPtr hit = WindowFromPoint(center);
        return IsLockWindow(hit) || IsLockWindow(GetAncestor(hit, RootWindow));
    }

    public static string BlockedReason() {
        IntPtr desktop = OpenInputDesktop(0, false, ReadObjects);
        if (desktop == IntPtr.Zero)
            return "Cannot open the interactive input desktop: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
        try {
            uint required;
            StringBuilder name = new StringBuilder(256);
            if (!ReadName(desktop, UserObjectName, name, name.Capacity * sizeof(char), out required))
                return "Cannot identify the input desktop: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
            if (!string.Equals(name.ToString(), "Default", StringComparison.OrdinalIgnoreCase))
                return "The input desktop is " + name + ", expected the interactive Default desktop.";
            int receivesInput;
            if (!ReadFlag(desktop, UserObjectReceivesInput, out receivesInput, sizeof(int), out required) || receivesInput == 0)
                return "The Default desktop is not receiving user input.";
            if (IsLockScreenShowing()) return "Windows is showing the lock or sign-in screen.";
            return null;
        } finally {
            CloseDesktop(desktop);
        }
    }
}
'@
}

if ($Describe) {
    $reason = [E2eInputDesktop]::BlockedReason()
    @{ available = ($null -eq $reason); reason = $reason } | ConvertTo-Json -Compress
}
