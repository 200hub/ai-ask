param(
    [Parameter(Mandatory = $true)][int] $ProcessId,
    [long] $NoteHwnd = 0,
    [long] $MainHwnd = 0,
    [ValidateSet('Inspect', 'ToggleDesktop', 'WinD', 'FocusMain', 'FocusNote')][string] $Action = 'Inspect',
    [ValidateRange(0, 5000)][int] $SettleMs = 400,
    [string] $ScreenshotPath,
    [switch] $Interactive
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'input-desktop.ps1')

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class ShowDesktopProbe {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect {
        public int Left, Top, Right, Bottom;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Point {
        public int X, Y;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput {
        public ushort VirtualKey, ScanCode;
        public uint Flags, Time;
        public UIntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput {
        public int X, Y;
        public uint MouseData, Flags, Time;
        public UIntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Input {
        public uint Type;
        public InputUnion Data;
    }

    private const uint Root = 2;
    private const uint DwmFrameBounds = 9;
    private const uint DwmCloaked = 14;
    private const int ExtendedStyle = -20;
    private const int Topmost = 0x00000008;
    private const uint PreserveWindow = 0x0013; // SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE
    private const uint KeyboardType = 1;
    private const uint MouseType = 0;
    private const uint LeftDown = 2;
    private const uint LeftUp = 4;
    private const uint KeyUp = 2;
    private const ushort LeftWin = 0x5b;
    private const ushort LetterD = 0x44;
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr data);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder buffer, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder buffer, int capacity);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")]
    private static extern int ReadDwmFlags(IntPtr hwnd, uint attribute, out uint flags, uint size);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")]
    private static extern int ReadDwmRect(IntPtr hwnd, uint attribute, out Rect rect, uint size);

    public static long FindWindowByTitle(uint processId, string title) {
        IntPtr match = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr data) {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner != processId) return true;
            StringBuilder text = new StringBuilder(256);
            if (GetWindowText(hwnd, text, text.Capacity) > 0 &&
                string.Equals(text.ToString(), title, StringComparison.Ordinal)) {
                match = hwnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return match.ToInt64();
    }

    public static string ClassName(IntPtr hwnd) {
        StringBuilder text = new StringBuilder(256);
        return GetClassName(hwnd, text, text.Capacity) > 0 ? text.ToString() : null;
    }

    public static bool IsTopmost(IntPtr hwnd) {
        return (GetWindowLong(hwnd, ExtendedStyle) & Topmost) != 0;
    }

    public static uint? CloakFlags(IntPtr hwnd) {
        uint flags;
        return ReadDwmFlags(hwnd, DwmCloaked, out flags, sizeof(uint)) == 0 ? (uint?)flags : null;
    }

    public static Rect? Bounds(IntPtr hwnd) {
        Rect rect;
        if (ReadDwmRect(hwnd, DwmFrameBounds, out rect, (uint)Marshal.SizeOf(typeof(Rect))) == 0) {
            return rect;
        }
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            return GetWindowRect(hwnd, out rect) ? (Rect?)rect : null;
        } finally {
            if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
        }
    }

    public static IntPtr HitAtCenter(Rect rect) {
        Point point = new Point {
            X = rect.Left + (rect.Right - rect.Left) / 2,
            Y = rect.Top + (rect.Bottom - rect.Top) / 2
        };
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            return GetAncestor(WindowFromPoint(point), Root);
        } finally {
            if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
        }
    }

    private static Input Key(ushort key, uint flags) {
        return new Input {
            Type = KeyboardType,
            Data = new InputUnion { Keyboard = new KeyboardInput { VirtualKey = key, Flags = flags } }
        };
    }

    public static void SendWinD() {
        Input[] keys = { Key(LeftWin, 0), Key(LetterD, 0), Key(LetterD, KeyUp), Key(LeftWin, KeyUp) };
        int size = Marshal.SizeOf(typeof(Input));
        if (SendInput((uint)keys.Length, keys, size) != keys.Length) {
            int error = Marshal.GetLastWin32Error();
            Input[] release = { Key(LetterD, KeyUp), Key(LeftWin, KeyUp) };
            SendInput((uint)release.Length, release, size);
            throw new Win32Exception(error, "Could not send the complete Win+D shortcut.");
        }
    }

    private static void SendMouseButton(uint flags) {
        Input[] input = {
            new Input { Type = MouseType, Data = new InputUnion { Mouse = new MouseInput { Flags = flags } } }
        };
        if (SendInput(1, input, Marshal.SizeOf(typeof(Input))) != 1)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not send test mouse input.");
    }

    public static void DragWithinWindow(IntPtr hwnd, int fromX, int fromY, int toX, int toY) {
        FocusWindow(hwnd, false);
        IntPtr previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
        Point cursor;
        bool hadCursor = GetCursorPos(out cursor);
        try {
            Point from = new Point { X = fromX, Y = fromY };
            Point to = new Point { X = toX, Y = toY };
            if (!ClientToScreen(hwnd, ref from) || !ClientToScreen(hwnd, ref to))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not map test drag coordinates.");
            if (GetAncestor(WindowFromPoint(from), Root) != hwnd || GetAncestor(WindowFromPoint(to), Root) != hwnd)
                throw new InvalidOperationException("Both drag points must be exposed inside the test note.");
            if (!SetCursorPos(from.X, from.Y))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not move to the drag handle.");
            SendMouseButton(LeftDown);
            try {
                const int steps = 14;
                for (int step = 1; step <= steps; step++) {
                    Thread.Sleep(25);
                    if (!SetCursorPos(from.X + (to.X - from.X) * step / steps, from.Y + (to.Y - from.Y) * step / steps))
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not move the dragged item.");
                }
                // WebView2 enters its native drag loop after the threshold is crossed.
                // Move once more in the target row so the drop is based on a dragover there.
                Thread.Sleep(75);
                SetCursorPos(to.X + 1, to.Y);
                Thread.Sleep(75);
            } finally {
                SendMouseButton(LeftUp);
                Thread.Sleep(100);
            }
        } finally {
            if (hadCursor) SetCursorPos(cursor.X, cursor.Y);
            if (previousDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi);
        }
    }

    public static void FocusWindow(IntPtr hwnd, bool mayRaise) {
        if (GetForegroundWindow() == hwnd || SetForegroundWindow(hwnd)) return;
        // Win32 can deny programmatic activation from a background process. A covered
        // test main window can briefly be raised so the hit-tested click reaches it.
        // A note must never be raised here because the test verifies its actual layer.
        bool raised = mayRaise && !IsTopmost(hwnd);
        if (raised && !SetWindowPos(hwnd, new IntPtr(-1), 0, 0, 0, 0, PreserveWindow)) {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not expose the test main window.");
        }
        IntPtr previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
        Point cursor;
        bool hadCursor = GetCursorPos(out cursor);
        try {
            Rect? bounds = Bounds(hwnd);
            if (!bounds.HasValue) throw new InvalidOperationException("No test window bounds.");
            Rect rect = bounds.Value;
            // Wait briefly for DWM to publish the new Z-order before checking the point.
            for (int attempt = 0; attempt < 10; attempt++) {
                foreach (int offset in new [] { 24, 48, 96, 144 }) {
                    Point point = new Point { X = rect.Left + offset, Y = rect.Top + 14 };
                    if (point.X >= rect.Right || GetAncestor(WindowFromPoint(point), Root) != hwnd) continue;
                    Point actual;
                    if (!SetCursorPos(point.X, point.Y) || !GetCursorPos(out actual) ||
                        GetAncestor(WindowFromPoint(actual), Root) != hwnd) continue;
                    Input[] click = {
                        new Input { Type = MouseType, Data = new InputUnion { Mouse = new MouseInput { Flags = LeftDown } } },
                        new Input { Type = MouseType, Data = new InputUnion { Mouse = new MouseInput { Flags = LeftUp } } }
                    };
                    int size = Marshal.SizeOf(typeof(Input));
                    if (SendInput((uint)click.Length, click, size) != click.Length) {
                        int error = Marshal.GetLastWin32Error();
                        SendInput(1, new [] { click[1] }, size);
                        throw new Win32Exception(error, "Could not activate test window.");
                    }
                    // Keep the target exposed until Windows consumes the queued click.
                    for (int wait = 0; wait < 20 && GetForegroundWindow() != hwnd; wait++) Thread.Sleep(25);
                    if (GetForegroundWindow() != hwnd) {
                        throw new InvalidOperationException("The test window did not take foreground focus after the click.");
                    }
                    return;
                }
                Thread.Sleep(25);
            }
            throw new InvalidOperationException("Could not find an exposed point on the test window.");
        } finally {
            if (hadCursor) SetCursorPos(cursor.X, cursor.Y);
            if (previousDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi);
            if (raised && IsWindow(hwnd) &&
                !SetWindowPos(hwnd, new IntPtr(-2), 0, 0, 0, 0, PreserveWindow)) {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not restore the test main window layer.");
            }
        }
    }

    public static void CaptureRegion(Rect rect, string path) {
        if (!Path.IsPathRooted(path) || !string.Equals(Path.GetExtension(path), ".png", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("ScreenshotPath must be an absolute PNG path.");
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0)
            throw new ArgumentException("The note has no valid screen region to capture.");
        using (Bitmap image = new Bitmap(width, height))
        using (Graphics graphics = Graphics.FromImage(image)) {
            IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
            try {
                graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, image.Size);
                image.Save(path, ImageFormat.Png);
            } finally {
                if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
            }
        }
    }
}
'@

function Read-WindowState([long] $Handle) {
    if ($Handle -eq 0) {
        return $null
    }
    $window = [IntPtr]::new($Handle)
    if (-not [ShowDesktopProbe]::IsWindow($window)) {
        return @{ hwnd = $Handle; exists = $false }
    }
    [uint32] $windowProcessId = 0
    [void][ShowDesktopProbe]::GetWindowThreadProcessId($window, [ref] $windowProcessId)
    if ($windowProcessId -ne $ProcessId) {
        throw "Window $Handle belongs to process $windowProcessId, expected $ProcessId."
    }

    $rect = [ShowDesktopProbe]::Bounds($window)
    $hit = if ($null -ne $rect) { [ShowDesktopProbe]::HitAtCenter($rect).ToInt64() } else { 0 }
    $frame = if ($null -ne $rect) {
        @{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom }
    }
    return @{
        hwnd = $Handle
        exists = $true
        visible = [ShowDesktopProbe]::IsWindowVisible($window)
        iconic = [ShowDesktopProbe]::IsIconic($window)
        topmost = [ShowDesktopProbe]::IsTopmost($window)
        cloakFlags = [ShowDesktopProbe]::CloakFlags($window)
        centerHitHwnd = $hit
        centerHitsWindow = ($hit -eq $Handle)
        rect = $frame
    }
}

function Invoke-Probe([string] $Mode, [int] $WaitMs, [string] $CapturePath, [long] $NoteHandle, [long] $MainHandle, $Request) {
    Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
    if ($NoteHandle -eq 0) {
        $NoteHandle = [ShowDesktopProbe]::FindWindowByTitle($ProcessId, 'Sticky Note')
    }
    if ($MainHandle -eq 0) {
        $MainHandle = [ShowDesktopProbe]::FindWindowByTitle($ProcessId, 'AI Ask')
    }
    $note = Read-WindowState $NoteHandle
    $main = Read-WindowState $MainHandle
    if ($Mode -ne 'Inspect') {
        $blocked = [E2eInputDesktop]::BlockedReason()
        if ($blocked) { throw $blocked }
        if ($Mode -ne 'FocusMain' -and -not $note.exists) {
            throw 'Show Desktop actions require a valid note window owned by the test process.'
        }
        switch ($Mode) {
            'ToggleDesktop' {
                $shell = New-Object -ComObject Shell.Application
                try {
                    [void]$shell.ToggleDesktop()
                }
                finally {
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
                }
            }
            'WinD' { [ShowDesktopProbe]::SendWinD() }
            'FocusMain' {
                if (-not $main.exists) { throw 'A valid main window owned by the test process is required.' }
                [ShowDesktopProbe]::FocusWindow([IntPtr]::new($MainHandle), $true)
            }
            'FocusNote' { [ShowDesktopProbe]::FocusWindow([IntPtr]::new($NoteHandle), $false) }
            'DragNote' {
                if (-not $Request.from -or -not $Request.to) { throw 'DragNote requires client coordinates.' }
                [ShowDesktopProbe]::DragWithinWindow(
                    [IntPtr]::new($NoteHandle),
                    [int]$Request.from.x, [int]$Request.from.y,
                    [int]$Request.to.x, [int]$Request.to.y
                )
            }
            default { throw "Unknown action $Mode." }
        }
        Start-Sleep -Milliseconds $WaitMs
        $note = Read-WindowState $NoteHandle
        $main = Read-WindowState $MainHandle
    }
    if ($CapturePath) {
        if (-not $note.centerHitsWindow -or $note.iconic -or -not $note.visible -or $note.cloakFlags -ne 0) {
            throw 'The note must be visible, unminimized, and hit-testable to capture its screen region.'
        }
        $bounds = [ShowDesktopProbe]::Bounds([IntPtr]::new($NoteHandle))
        [ShowDesktopProbe]::CaptureRegion($bounds, $CapturePath)
    }

    $foreground = [ShowDesktopProbe]::GetForegroundWindow()
    return @{
        action = $Mode
        foregroundHwnd = $foreground.ToInt64()
        foregroundClassName = [ShowDesktopProbe]::ClassName($foreground)
        shellHwnd = [ShowDesktopProbe]::GetShellWindow().ToInt64()
        note = $note
        main = $main
    }
}

if ($Interactive) {
    [Console]::WriteLine('{"ready":true}')
    while ($null -ne ($line = [Console]::ReadLine())) {
        try {
            $request = ConvertFrom-Json -InputObject $line
            if ($request.action -eq 'Exit') { break }
            $mode = if ($request.action) { $request.action } else { $Action }
            $wait = if ($null -ne $request.settleMs) { [int]$request.settleMs } else { $SettleMs }
            if ($wait -lt 0 -or $wait -gt 5000) { throw 'settleMs must be between 0 and 5000.' }
            $capture = if ($request.screenshotPath) { $request.screenshotPath } else { $ScreenshotPath }
            $note = if ($null -ne $request.noteHwnd) { [long]$request.noteHwnd } else { $NoteHwnd }
            $main = if ($null -ne $request.mainHwnd) { [long]$request.mainHwnd } else { $MainHwnd }
            $response = Invoke-Probe $mode $wait $capture $note $main $request
        }
        catch {
            $response = @{ error = $_.Exception.Message }
        }
        [Console]::WriteLine((ConvertTo-Json -InputObject $response -Depth 5 -Compress))
    }
}
else {
    $response = Invoke-Probe $Action $SettleMs $ScreenshotPath $NoteHwnd $MainHwnd
    [Console]::WriteLine((ConvertTo-Json -InputObject $response -Depth 5 -Compress))
}
