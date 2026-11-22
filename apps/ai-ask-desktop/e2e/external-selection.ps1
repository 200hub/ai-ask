param([switch] $CompileOnly)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'input-desktop.ps1')

Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public static class ExternalSelectionFixture {
    private const string First = "External drag selection";
    private const string Second = "Ignored external selection";
    private const string Padding = "    ";
    private const string FixtureText = Padding + First + Padding + "\r\n" + Padding + Second + Padding;
    private const uint Child = 0x40000000;
    private const uint Visible = 0x10000000;
    private const uint TabStop = 0x00010000;
    private const uint ReadOnly = 0x0800;
    private const uint Multiline = 0x0004;
    private const uint GetSelection = 0x00b0;
    private const uint SetSelection = 0x00b1;
    private const uint PositionFromCharacter = 0x00d6;
    private const uint SetFont = 0x0030;
    private const uint MouseType = 0;
    private const uint KeyboardType = 1;
    private const uint LeftDown = 2;
    private const uint LeftUp = 4;
    private const uint KeyUp = 2;
    private const uint NoSize = 0x0001;
    private const uint NoMove = 0x0002;
    private const uint NoActivate = 0x0010;
    private const uint ShowWindow = 0x0040;
    private static readonly IntPtr Topmost = new IntPtr(-1);
    private const ushort Control = 0x11;
    private const ushort Alt = 0x12;
    private const ushort Shift = 0x10;
    private const ushort F8 = 0x77;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput {
        public ushort Key, Scan;
        public uint Flags, Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput {
        public int X, Y;
        public uint Data, Flags, Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputData {
        [FieldOffset(0)] public KeyboardInput Key;
        [FieldOffset(0)] public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input {
        public uint Type;
        public InputData Data;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPhysicalPoint(Point point);
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder buffer, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint extendedStyle, string windowClass, string title,
        uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameters);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr handle);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] input, int size);

    private static void Send(params Input[] inputs) {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) != inputs.Length) {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Incomplete fixture input.");
        }
    }

    private static Input Mouse(uint flags) {
        return new Input { Type = MouseType, Data = new InputData { Mouse = new MouseInput { Flags = flags } } };
    }

    private static Input Key(ushort key, uint flags) {
        return new Input { Type = KeyboardType, Data = new InputData { Key = new KeyboardInput { Key = key, Flags = flags } } };
    }

    private static void Move(Point point) {
        if (!SetCursorPos(point.X, point.Y)) {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not move to the fixture.");
        }
    }

    private static Point CharacterPoint(IntPtr edit, int index) {
        long packed = SendMessage(edit, PositionFromCharacter, new IntPtr(index), IntPtr.Zero).ToInt64();
        if (packed == -1) throw new InvalidOperationException("The fixture character is offscreen.");
        return new Point((short)(packed & 0xffff), (short)((packed >> 16) & 0xffff));
    }

    private static string SelectedText(IntPtr edit) {
        long packed = SendMessage(edit, GetSelection, IntPtr.Zero, IntPtr.Zero).ToInt64();
        int start = (int)(packed & 0xffff);
        int end = (int)((packed >> 16) & 0xffff);
        if (end > FixtureText.Length || start > end)
            throw new InvalidOperationException("The fixture selection is out of bounds.");
        return FixtureText.Substring(start, end - start).Trim();
    }

    private static string ClassName(IntPtr hwnd) {
        StringBuilder name = new StringBuilder(256);
        GetClassName(hwnd, name, name.Capacity);
        return name.ToString();
    }

    private static bool HitsFixture(Point point, IntPtr formHandle, IntPtr editHandle) {
        IntPtr hit = WindowFromPhysicalPoint(point);
        return hit == editHandle || GetAncestor(hit, 2) == formHandle;
    }

    private static void PrintState(Form form, IntPtr edit, IntPtr inputForeground) {
        Console.WriteLine((string)form.Invoke(new Func<string>(delegate {
            IntPtr foreground = GetForegroundWindow();
            uint foregroundPid;
            GetWindowThreadProcessId(foreground, out foregroundPid);
            uint inputForegroundPid;
            GetWindowThreadProcessId(inputForeground, out inputForegroundPid);
            return new JavaScriptSerializer().Serialize(new {
                hwnd = form.Handle.ToInt64(),
                editHwnd = edit.ToInt64(),
                inputForegroundHwnd = inputForeground.ToInt64(),
                inputForegroundPid = inputForegroundPid,
                foregroundHwnd = foreground.ToInt64(),
                foregroundPid = foregroundPid,
                windowClass = ClassName(form.Handle),
                editClass = ClassName(edit),
                selectedText = SelectedText(edit)
            });
        })));
    }

    private static void Activate(Form form, IntPtr formHandle, IntPtr editHandle, Point? safePoint) {
        form.Invoke(new Action(delegate {
            form.Activate();
            SetFocus(editHandle);
            SetForegroundWindow(formHandle);
        }));
        if (GetForegroundWindow() != formHandle && safePoint.HasValue) {
            if (!HitsFixture(safePoint.Value, formHandle, editHandle))
                throw new InvalidOperationException("The fixture editor is obscured.");
            Move(safePoint.Value);
            Send(Mouse(LeftDown), Mouse(LeftUp));
            Thread.Sleep(120);
        }
        RequireForeground(formHandle);
    }

    private static IntPtr RequireForeground(IntPtr formHandle) {
        IntPtr foreground = GetForegroundWindow();
        if (foreground != formHandle)
            throw new InvalidOperationException("The fixture lost foreground before sending input.");
        return foreground;
    }

    private static IntPtr Drag(Form form, IntPtr formHandle, IntPtr editHandle, string text) {
        Point[] points = (Point[])form.Invoke(new Func<Point[]>(delegate {
            int start = FixtureText.IndexOf(text, StringComparison.Ordinal);
            Point from = CharacterPoint(editHandle, start - Padding.Length + 1);
            Point to = CharacterPoint(editHandle, start + text.Length + Padding.Length - 1);
            int secondLine = FixtureText.IndexOf(Second, StringComparison.Ordinal);
            int lineHeight = CharacterPoint(editHandle, secondLine).Y - CharacterPoint(editHandle, 0).Y;
            from.Offset(0, lineHeight / 2);
            to.Offset(0, lineHeight / 2);
            Point origin = EditScreenOrigin(editHandle);
            from.Offset(origin);
            to.Offset(origin);
            return new[] { from, to };
        }));
        Activate(form, formHandle, editHandle, points[0]);
        // A non-activating topmost toolbar can be raised independently of foreground focus.
        if (!SetWindowPos(formHandle, Topmost, 0, 0, 0, 0, NoSize | NoMove | NoActivate))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not raise the fixture before dragging.");
        if (!HitsFixture(points[0], formHandle, editHandle) || !HitsFixture(points[1], formHandle, editHandle)) {
            throw new InvalidOperationException(String.Format(
                "The selection endpoints {0} -> {1} are obscured; hits {2} / {3}, expected fixture {4} or EDIT {5}.",
                points[0], points[1], ClassName(WindowFromPhysicalPoint(points[0])), ClassName(WindowFromPhysicalPoint(points[1])), formHandle, editHandle));
        }
        Move(points[0]);
        Thread.Sleep(120);
        IntPtr foreground = RequireForeground(formHandle);
        if (!HitsFixture(points[0], formHandle, editHandle))
            throw new InvalidOperationException("The selection start is no longer over the fixture.");
        Send(Mouse(LeftDown));
        try {
            for (int step = 1; step <= 5; step++) {
                Point next = new Point(points[0].X + (points[1].X - points[0].X) * step / 5, points[0].Y);
                Move(next);
                Thread.Sleep(25);
            }
            RequireForeground(formHandle);
        } finally {
            Send(Mouse(LeftUp));
        }
        return foreground;
    }

    private static Point EditScreenOrigin(IntPtr edit) {
        Rect rect;
        if (!GetWindowRect(edit, out rect)) {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not resolve editor screen coordinates.");
        }
        return new Point(rect.Left, rect.Top);
    }

    private static IntPtr PressHotkey(Form form, IntPtr formHandle, IntPtr editHandle, long selection) {
        // If Windows has already handed foreground to another window, click inside our fixture's
        // unused area to reacquire it. Keep the click out of the EDIT so its selection survives.
        Point safePoint = (Point)form.Invoke(new Func<Point>(delegate { return form.PointToScreen(new Point(8, 8)); }));
        Activate(form, formHandle, editHandle, safePoint);
        // Regaining focus can collapse a native EDIT selection. Restore the range read after the physical drag.
        form.Invoke(new Action(delegate {
            SetFocus(editHandle);
            SendMessage(editHandle, SetSelection, new IntPtr(selection & 0xffff), new IntPtr((selection >> 16) & 0xffff));
        }));
        IntPtr foreground = RequireForeground(formHandle);
        try {
            Send(Key(Control, 0), Key(Alt, 0), Key(Shift, 0), Key(F8, 0));
        } finally {
            Send(Key(F8, KeyUp), Key(Shift, KeyUp), Key(Alt, KeyUp), Key(Control, KeyUp));
        }
        return foreground;
    }

    public static void Run(Func<string> inputBlockedReason) {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        Application.EnableVisualStyles();
        using (Form form = new Form()) {
            form.Text = "AI Ask external selection fixture";
            form.StartPosition = FormStartPosition.CenterScreen;
            form.ClientSize = new Size(480, 130);
            IntPtr font = SystemFonts.MessageBoxFont.ToHfont();
            form.Shown += delegate {
                IntPtr formHandle = form.Handle;
                IntPtr editHandle = CreateWindowEx(0, "EDIT", FixtureText, Child | Visible | TabStop | ReadOnly | Multiline, 16, 16,
                    form.ClientSize.Width - 32, form.ClientSize.Height - 32,
                    formHandle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (editHandle == IntPtr.Zero) {
                    Console.Error.WriteLine(new Win32Exception(Marshal.GetLastWin32Error(), "Could not create native EDIT."));
                    form.Close();
                    return;
                }
                SendMessage(editHandle, SetFont, font, new IntPtr(1));
                Thread control = new Thread(delegate() {
                    SetThreadDpiAwarenessContext(new IntPtr(-4));
                    Console.WriteLine("{\"ready\":true}");
                    long selection = 0;
                    try {
                        for (string command = Console.ReadLine(); command != null && command != "Exit"; command = Console.ReadLine()) {
                            if (command != "Inspect") {
                                string blocked = inputBlockedReason();
                                if (blocked != null) throw new InvalidOperationException(blocked);
                            }
                            if (command != "Inspect") {
                                form.Invoke(new Action(delegate {
                                    if (!SetWindowPos(formHandle, Topmost, 100, 130, 0, 0, NoSize | ShowWindow))
                                        throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not raise the fixture.");
                                }));
                            }
                            try {
                                IntPtr inputForeground = IntPtr.Zero;
                                switch (command) {
                                    case "DragFirst": inputForeground = Drag(form, formHandle, editHandle, First); break;
                                    case "DragSecond": inputForeground = Drag(form, formHandle, editHandle, Second); break;
                                    case "Hotkey": inputForeground = PressHotkey(form, formHandle, editHandle, selection); break;
                                    case "Inspect": break;
                                    default: throw new InvalidOperationException("Unknown fixture command: " + command);
                                }
                                // Keep the fixture above other windows while it handles the queued input.
                                Thread.Sleep(150);
                                if (command == "DragFirst" || command == "DragSecond")
                                    selection = SendMessage(editHandle, GetSelection, IntPtr.Zero, IntPtr.Zero).ToInt64();
                                PrintState(form, editHandle, inputForeground);
                            } catch (InvalidOperationException error) {
                                Console.WriteLine(new JavaScriptSerializer().Serialize(new { inputError = error.Message }));
                            }
                        }
                    } catch (Exception error) {
                        Console.Error.WriteLine(error);
                    } finally {
                        if (!form.IsDisposed) form.BeginInvoke(new Action(form.Close));
                    }
                });
                control.IsBackground = true;
                control.Start();
            };
            try {
                Application.Run(form);
            } finally {
                DeleteObject(font);
            }
        }
    }
}
'@

if (-not $CompileOnly) {
    $blocked = [E2eInputDesktop]::BlockedReason()
    if ($blocked) { throw $blocked }
    $desktopProbe = [E2eInputDesktop].GetMethod('BlockedReason')
    $checkDesktop = [Delegate]::CreateDelegate([Func[string]], $desktopProbe)
    [ExternalSelectionFixture]::Run($checkDesktop)
}
