/**
 * English Translation
 */

export const enUS = {
    common: {
        confirm: "Confirm",
        cancel: "Cancel",
        save: "Save",
        delete: "Delete",
        edit: "Edit",
        add: "Add",
        close: "Close",
        back: "Back",
        next: "Next",
        previous: "Previous",
        search: "Search",
        loading: "Loading...",
        success: "Success",
        error: "Error",
        warning: "Warning",
        info: "Info",
        yes: "Yes",
        no: "No",
    },

    app: {
        name: "AI Ask",
        title: "AI Assistant",
        description: "A simple and efficient AI Q&A assistant",
    },

    sidebar: {
        platforms: "AI Platforms",
        translation: "Translation",
        settings: "Settings",
    },

    header: {
        refresh: "Refresh",
        openInBrowser: "Open in Browser",
        minimize: "Minimize",
        close: "Close",
    },

    settings: {
        title: "Settings",
        general: "General",
        platforms: "AI Platforms",
        proxy: "Proxy",
        translation: "Translation",
        about: "About",
    },

    general: {
        title: "General Settings",
        appearance: "Appearance",
        theme: "Theme Mode",
        themeDescription: "Choose the appearance theme of the app",
        themeSystem: "Follow System",
        themeLight: "Light",
        themeDark: "Dark",
        shortcuts: "Shortcuts",
        globalHotkey: "Global Hotkey",
        globalHotkeyDescription: "Show/Hide application window",
        translationHotkey: "Translation Hotkey",
        translationHotkeyDescription: "Quick access to translation",
        startup: "Startup",
        autoStart: "Launch at Startup",
        autoStartDescription: "Automatically run when system starts",
        infoTip1: "Closing the app will minimize it to the system tray instead of exiting.",
        infoTip2: "Right-click the tray icon and select 'Quit' to completely close the app.",
    },

    platforms: {
        title: "AI Platform Management",
        description: "Manage and configure AI platforms",
        addPlatform: "Add Platform",
        editPlatform: "Edit Platform",
        noPlatforms: "No Platforms",
        noPlatformsDescription: "Click the button below to add an AI platform",
        name: "Platform Name",
        namePlaceholder: "e.g., ChatGPT",
        url: "Platform URL",
        urlPlaceholder: "https://",
        icon: "Icon URL",
        iconPlaceholder: "https://",
        enabled: "Enabled",
        disabled: "Disabled",
        dragToReorder: "Drag to reorder",
        required: "Required field",
        invalidUrl: "Please enter a valid URL",
    },

    proxy: {
        title: "Network Proxy",
        description: "Configure network proxy settings",
        type: "Proxy Type",
        none: "No Proxy",
        noneDescription: "Direct connection without proxy",
        system: "System Proxy",
        systemDescription: "Use system configured proxy settings",
        custom: "Custom Proxy",
        customDescription: "Manually configure proxy server",
        host: "Proxy Address",
        hostPlaceholder: "127.0.0.1",
        port: "Port",
        portPlaceholder: "7890",
        example: "Example",
        testConnection: "Test Connection",
        saveSettings: "Save Settings",
        infoTip1: "Tip: After modifying proxy settings, you need to reload the webpage for changes to take effect.",
        infoTip2: "Common proxy ports: HTTP/HTTPS proxies typically use ports like 7890, 8080, 1080.",
        saveSuccess: "Proxy settings saved",
        saveFailed: "Failed to save, please try again",
        testInProgress: "Proxy testing feature is under development...",
    },

    translationSettings: {
        title: "Translation Settings",
        description: "Configure translation features",
        defaultTranslator: "Default Translation Engine",
        selectTranslator: "Select Translation Engine",
    },

    about: {
        title: "About",
        version: "Version",
        description: "A simple and efficient AI Q&A assistant",
        features: "Key Features",
        feature1: "Multi-AI Platform Support",
        feature2: "Smart Translation",
        feature3: "Flexible Configuration",
        feature4: "Clean & Elegant UI",
        openSource: "Open Source",
        license: "This project is licensed under the MIT License",
        visitRepository: "Visit GitHub Repository",
        copyright: "All Rights Reserved",
    },

    chat: {
        loading: "Loading...",
        loadError: "Load Failed",
        loadErrorMessage: "Unable to load page, please check network connection or proxy settings",
        reload: "Reload",
        selectPlatform: "Please select an AI platform",
        embedNotSupported: "Embedding Not Supported",
        embedNotSupportedMessage: "Due to security policies, {platform} cannot be displayed within the app.",
        embedNotSupportedReason: "Why is this happening?",
        embedNotSupportedDetail: "This platform has set X-Frame-Options or Content Security Policy restrictions to protect user account security.",
        openInBrowser: "Open {platform} in Browser",
        retry: "Retry",
        openExternal: "Open in Browser",
    },

    translation: {
        title: "Translation",
        selectPlatform: "Select Translation Platform",
        noPlatforms: "No translation platforms available",
        noPlatformsDescription: "Please add translation platforms in settings",
    },

    tray: {
        show: "Show",
        hide: "Hide",
        quit: "Quit",
    },

    errors: {
        networkError: "Network Error",
        loadFailed: "Load Failed",
        saveFailed: "Save Failed",
        unknownError: "Unknown Error",
    },
};

export default enUS;
