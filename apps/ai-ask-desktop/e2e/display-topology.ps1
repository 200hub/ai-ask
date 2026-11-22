$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class E2eDisplayTopology {
    private const uint ActivePaths = 2;
    private const uint DatabaseCurrent = 4;
    private const int InsufficientBuffer = 122;
    private const int MonitorEffectiveDpi = 0;
    private const int InternalTechnology = unchecked((int)0x80000000);
    private const uint Primary = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PathSource {
        public Luid Adapter;
        public uint Id, ModeIndex, StatusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PathTarget {
        public Luid Adapter;
        public uint Id, ModeIndex;
        public int Technology, Rotation, Scaling;
        public uint RefreshNumerator, RefreshDenominator;
        public int ScanLineOrdering;
        public int Available;
        public uint StatusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PathInfo {
        public PathSource Source;
        public PathTarget Target;
        public uint Flags;
    }

    // DISPLAYCONFIG_MODE_INFO includes a 48-byte union aligned at offset 16.
    [StructLayout(LayoutKind.Explicit, Size = 64)]
    private struct ModeInfo {
        [FieldOffset(16)] public ulong UnionAlignment;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DeviceHeader {
        public uint Type, Size;
        public Luid Adapter;
        public uint Id;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SourceName {
        public DeviceHeader Header;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct TargetName {
        public DeviceHeader Header;
        public uint Flags;
        public int Technology;
        public ushort Manufacturer, Product;
        public uint ConnectorInstance;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string FriendlyName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DevicePath;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfo {
        public uint Size;
        public Rect Bounds, WorkArea;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    }

    public sealed class Region {
        public int x, y, width, height;
    }

    public sealed class Dpi {
        public uint x, y;
    }

    public sealed class Monitor {
        public string deviceName;
        public bool primary;
        public Region bounds, workArea;
        public Dpi dpi;
        public string[] targetNames, connectors, targetIds;
    }

    public sealed class Snapshot {
        public string mode, databaseMode;
        public Monitor[] monitors;
        public int? activeTargetCount, pathQueryError;
    }

    private sealed class Target {
        public string Name, Connector, Id;
        public bool Internal;
    }

    private delegate bool MonitorCallback(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr rect, MonitorCallback callback, IntPtr data);
    [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(IntPtr monitor, int dpiType, out uint x, out uint y);
    [DllImport("user32.dll")]
    private static extern int GetDisplayConfigBufferSizes(uint flags, out uint pathCount, out uint modeCount);
    [DllImport("user32.dll")]
    private static extern int QueryDisplayConfig(uint flags, ref uint pathCount, [Out] PathInfo[] paths, ref uint modeCount, [Out] ModeInfo[] modes, IntPtr topology);
    [DllImport("user32.dll")]
    private static extern int DisplayConfigGetDeviceInfo(ref SourceName source);
    [DllImport("user32.dll")]
    private static extern int DisplayConfigGetDeviceInfo(ref TargetName target);

    private static Region Geometry(Rect rect) {
        return new Region { x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top };
    }

    private static string Connector(int technology) {
        switch (technology) {
            case InternalTechnology: return "Internal";
            case 0: return "VGA";
            case 4: return "DVI";
            case 5: return "HDMI";
            case 6: return "LVDS";
            case 10: return "DisplayPort";
            case 11: return "Embedded DisplayPort";
            case 13: return "Embedded UDI";
            case 15: return "Miracast";
            case 16: return "Indirect wired";
            case 17: return "Indirect virtual";
            case 18: return "DisplayPort USB tunnel";
            default: return "Other (" + technology + ")";
        }
    }

    private static PathInfo[] QueryPaths(uint flags, IntPtr topology) {
        for (int attempt = 0; attempt < 4; attempt++) {
            uint pathCount, modeCount;
            int error = GetDisplayConfigBufferSizes(flags, out pathCount, out modeCount);
            if (error != 0) throw new Win32Exception(error);
            PathInfo[] paths = new PathInfo[pathCount];
            ModeInfo[] modes = new ModeInfo[modeCount];
            error = QueryDisplayConfig(flags, ref pathCount, paths, ref modeCount, modes, topology);
            if (error == InsufficientBuffer) continue;
            if (error != 0) throw new Win32Exception(error);
            Array.Resize(ref paths, (int)pathCount);
            return paths;
        }
        throw new Win32Exception(InsufficientBuffer, "The display paths are still changing.");
    }

    private static string QueryDatabaseMode() {
        IntPtr topology = Marshal.AllocHGlobal(sizeof(int));
        try {
            QueryPaths(DatabaseCurrent, topology);
            switch (Marshal.ReadInt32(topology)) {
                case 1: return "internal";
                case 2: return "duplicate";
                case 4: return "extend";
                case 8: return "external";
                default: return "unknown";
            }
        } catch (Win32Exception) {
            return "unknown";
        } finally {
            Marshal.FreeHGlobal(topology);
        }
    }

    public static Snapshot Inspect() {
        var snapshot = new Snapshot { mode = "unknown", databaseMode = QueryDatabaseMode() };
        var targets = new Dictionary<string, List<Target>>(StringComparer.OrdinalIgnoreCase);
        var monitors = new List<Monitor>();
        try {
            PathInfo[] paths = QueryPaths(ActivePaths, IntPtr.Zero);
            snapshot.activeTargetCount = paths.Length;
            foreach (PathInfo path in paths) {
                var source = new SourceName { Header = new DeviceHeader {
                    Type = 1, Size = (uint)Marshal.SizeOf(typeof(SourceName)), Adapter = path.Source.Adapter, Id = path.Source.Id
                } };
                var target = new TargetName { Header = new DeviceHeader {
                    Type = 2, Size = (uint)Marshal.SizeOf(typeof(TargetName)), Adapter = path.Target.Adapter, Id = path.Target.Id
                } };
                if (DisplayConfigGetDeviceInfo(ref source) != 0 || string.IsNullOrEmpty(source.Name)) continue;
                int targetError = DisplayConfigGetDeviceInfo(ref target);
                List<Target> devices;
                if (!targets.TryGetValue(source.Name, out devices)) {
                    devices = new List<Target>();
                    targets.Add(source.Name, devices);
                }
                int technology = path.Target.Technology;
                devices.Add(new Target {
                    Name = targetError == 0 ? target.FriendlyName : null,
                    Connector = Connector(technology),
                    Id = targetError == 0 ? target.DevicePath : null,
                    Internal = technology == InternalTechnology || technology == 6 || technology == 11 || technology == 13
                });
            }
        } catch (Win32Exception error) {
            snapshot.pathQueryError = error.NativeErrorCode;
        }

        // Preserve unvirtualized physical coordinates in a mixed-DPI desktop.
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            bool enumerated = EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data) {
                var info = new MonitorInfo { Size = (uint)Marshal.SizeOf(typeof(MonitorInfo)) };
                if (!GetMonitorInfo(monitor, ref info)) return true;
                List<Target> devices;
                if (!targets.TryGetValue(info.DeviceName, out devices)) devices = new List<Target>();
                uint x, y;
                monitors.Add(new Monitor {
                    deviceName = info.DeviceName,
                    primary = (info.Flags & Primary) != 0,
                    bounds = Geometry(info.Bounds),
                    workArea = Geometry(info.WorkArea),
                    dpi = GetDpiForMonitor(monitor, MonitorEffectiveDpi, out x, out y) == 0 ? new Dpi { x = x, y = y } : null,
                    targetNames = devices.ConvertAll(device => device.Name).FindAll(name => !string.IsNullOrEmpty(name)).ToArray(),
                    connectors = devices.ConvertAll(device => device.Connector).ToArray(),
                    targetIds = devices.ConvertAll(device => device.Id).FindAll(id => !string.IsNullOrEmpty(id)).ToArray()
                });
                return true;
            }, IntPtr.Zero);
            if (!enumerated) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
        }

        monitors.Sort((a, b) => StringComparer.OrdinalIgnoreCase.Compare(a.deviceName, b.deviceName));
        snapshot.monitors = monitors.ToArray();
        if (monitors.Count > 1) snapshot.mode = "extend";
        else if (monitors.Count == 1 && snapshot.activeTargetCount > 1) snapshot.mode = "duplicate";
        else if (monitors.Count == 1 && targets.Count == 1) {
            List<Target> devices;
            if (targets.TryGetValue(monitors[0].deviceName, out devices) && devices.Count == 1) {
                snapshot.mode = devices[0].Internal ? "internal" : "external";
            }
        }
        return snapshot;
    }
}
'@

$snapshot = [E2eDisplayTopology]::Inspect()
[Console]::WriteLine((ConvertTo-Json -InputObject $snapshot -Depth 6 -Compress))
