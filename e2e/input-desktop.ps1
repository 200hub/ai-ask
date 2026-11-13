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

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")]
    private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ReadName(IntPtr desktop, int index, StringBuilder value, int bytes, out uint required);
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", SetLastError = true)]
    private static extern bool ReadFlag(IntPtr desktop, int index, out int value, int bytes, out uint required);

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
            uint foregroundId;
            GetWindowThreadProcessId(GetForegroundWindow(), out foregroundId);
            if (foregroundId != 0) {
                try {
                    using (Process foreground = Process.GetProcessById((int)foregroundId)) {
                        string nameOfProcess = foreground.ProcessName;
                        if (string.Equals(nameOfProcess, "LockApp", StringComparison.OrdinalIgnoreCase)
                            || string.Equals(nameOfProcess, "LogonUI", StringComparison.OrdinalIgnoreCase))
                            return "Windows is showing the lock or sign-in screen.";
                    }
                } catch (ArgumentException) {
                    // The foreground window can exit between the two calls.
                }
            }
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
