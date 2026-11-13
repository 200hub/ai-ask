use std::{collections::HashMap, iter::once, mem::size_of};

use windows::{
    core::PCWSTR,
    Win32::{
        Devices::Display::{
            DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
            DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
            DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO,
            DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME,
            QDC_ONLY_ACTIVE_PATHS,
        },
        Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS},
        Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ACTIVE},
        UI::WindowsAndMessaging::EDD_GET_DEVICE_INTERFACE_NAME,
    },
};

const QUERY_ATTEMPTS: usize = 3;

pub(super) fn monitor_identities() -> HashMap<String, String> {
    let mut targets = HashMap::<String, Vec<Option<String>>>::new();
    for path in active_paths() {
        let Some(source) = source_name(&path) else {
            continue;
        };
        targets.entry(source).or_default().push(target_name(&path));
    }
    targets
        .into_iter()
        .filter_map(|(source, targets)| {
            let targets = targets.into_iter().collect::<Option<Vec<_>>>()?;
            physical_id(targets).map(|id| (source, id))
        })
        .collect()
}

pub(super) fn fallback_monitor_identity(source_name: &str) -> Option<String> {
    let source: Vec<_> = source_name.encode_utf16().chain(once(0)).collect();
    let mut targets = Vec::new();
    for index in 0.. {
        let mut monitor = DISPLAY_DEVICEW {
            cb: size_of::<DISPLAY_DEVICEW>() as u32,
            ..Default::default()
        };
        // SAFETY: The UTF-16 source name is NUL terminated and the output is
        // writable with cb set to the full size of the structure.
        let found = unsafe {
            EnumDisplayDevicesW(
                PCWSTR(source.as_ptr()),
                index,
                &mut monitor,
                EDD_GET_DEVICE_INTERFACE_NAME,
            )
        };
        if !found.as_bool() {
            break;
        }
        if monitor.StateFlags.contains(DISPLAY_DEVICE_ACTIVE) {
            targets.push(device_name(&monitor.DeviceID)?);
        }
    }
    physical_id(targets)
}

fn physical_id(mut targets: Vec<String>) -> Option<String> {
    targets.sort_unstable();
    targets.dedup();
    // A cloned GDI surface has its own profile, independent of each panel.
    match targets.as_slice() {
        [] => None,
        [target] => Some(format!("windows:{target}")),
        _ => Some(format!("windows:clone:{}", targets.join("|"))),
    }
}

fn active_paths() -> Vec<DISPLAYCONFIG_PATH_INFO> {
    for _ in 0..QUERY_ATTEMPTS {
        let mut path_count = 0;
        let mut mode_count = 0;
        // SAFETY: Both output counts point to initialized writable values.
        let result = unsafe {
            GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
        };
        if result != ERROR_SUCCESS || path_count == 0 || mode_count == 0 {
            break;
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        // SAFETY: Buffers are sized using the corresponding API and remain writable. Win32
        // reports ERROR_INSUFFICIENT_BUFFER when the topology changes before this query.
        let result = unsafe {
            QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                None,
            )
        };
        if result == ERROR_SUCCESS {
            paths.truncate(path_count as usize);
            return paths;
        }
        if result != ERROR_INSUFFICIENT_BUFFER {
            break;
        }
    }
    Vec::new()
}

fn source_name(path: &DISPLAYCONFIG_PATH_INFO) -> Option<String> {
    let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
        header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
            size: size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32,
            adapterId: path.sourceInfo.adapterId,
            id: path.sourceInfo.id,
        },
        ..Default::default()
    };
    // SAFETY: The repr(C) buffer begins with the matching header and its size
    // covers the complete writable structure.
    if unsafe { DisplayConfigGetDeviceInfo(&mut source.header) } != 0 {
        return None;
    }
    device_name(&source.viewGdiDeviceName)
}

fn target_name(path: &DISPLAYCONFIG_PATH_INFO) -> Option<String> {
    let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME {
        header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type: DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
            size: size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32,
            adapterId: path.targetInfo.adapterId,
            id: path.targetInfo.id,
        },
        ..Default::default()
    };
    // SAFETY: The repr(C) buffer begins with the matching header and its size
    // covers the complete writable structure.
    if unsafe { DisplayConfigGetDeviceInfo(&mut target.header) } != 0 {
        return None;
    }
    device_name(&target.monitorDevicePath)
}

fn device_name(buffer: &[u16]) -> Option<String> {
    let end = buffer
        .iter()
        .position(|&code| code == 0)
        .unwrap_or(buffer.len());
    (end > 0).then(|| String::from_utf16_lossy(&buffer[..end]).to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloned_surfaces_have_a_stable_identity_separate_from_each_target() {
        assert_eq!(
            physical_id(vec!["panel-b".into(), "panel-a".into(), "panel-b".into()]).as_deref(),
            Some("windows:clone:panel-a|panel-b")
        );
        assert_eq!(
            physical_id(vec!["panel-a".into()]).as_deref(),
            Some("windows:panel-a")
        );
        assert_eq!(physical_id(Vec::new()), None);
    }
}
