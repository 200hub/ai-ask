/**
 * 简体中文翻译
 */

export const zhCN = {
  common: {
    confirm: "确认",
    cancel: "取消",
    save: "保存",
    delete: "删除",
    edit: "编辑",
    add: "添加",
    close: "关闭",
    back: "返回",
    next: "下一步",
    previous: "上一步",
    search: "搜索",
    loading: "加载中...",
    success: "成功",
    error: "错误",
    warning: "警告",
    info: "提示",
    yes: "是",
    no: "否",
  },

  app: {
    name: "AI Ask",
    title: "AI 问答助手",
    description: "一个简洁高效的AI问答助手",
  },

  sidebar: {
    platforms: "AI平台",
    translation: "翻译",
    settings: "设置",
  },

  header: {
    refresh: "刷新",
    openInBrowser: "在浏览器中打开",
    minimize: "最小化",
    close: "关闭",
  },

  settings: {
    title: "设置",
    general: "通用",
    platforms: "AI平台",
    proxy: "代理",
    translation: "翻译",
    about: "关于",
  },

  general: {
    title: "通用设置",
    appearance: "外观",
    theme: "主题模式",
    themeDescription: "选择应用的外观主题",
    themeSystem: "跟随系统",
    themeLight: "浅色",
    themeDark: "深色",
    shortcuts: "快捷键",
    globalHotkey: "全局快捷键",
    globalHotkeyDescription: "显示/隐藏应用窗口",
    translationHotkey: "翻译快捷键",
    translationHotkeyDescription: "快速打开翻译功能",
    startup: "启动",
    autoStart: "开机自动启动",
    autoStartDescription: "系统启动时自动运行应用",
    infoTip1: "应用关闭时会最小化到系统托盘，不会完全退出。",
    infoTip2: '右键点击托盘图标选择"退出"可完全关闭应用。',
  },

  platforms: {
    title: "AI平台管理",
    description: "管理和配置AI平台",
    addPlatform: "添加平台",
    editPlatform: "编辑平台",
    noPlatforms: "暂无平台",
    noPlatformsDescription: "点击下方按钮添加AI平台",
    name: "平台名称",
    namePlaceholder: "例如：ChatGPT",
    url: "平台网址",
    urlPlaceholder: "https://",
    icon: "图标网址",
    iconPlaceholder: "https://",
    enabled: "启用",
    disabled: "禁用",
    dragToReorder: "拖动以重新排序",
    required: "必填项",
    invalidUrl: "请输入有效的网址",
  },

  proxy: {
    title: "网络代理",
    description: "配置应用的网络代理设置",
    type: "代理类型",
    none: "不使用代理",
    noneDescription: "直接连接，不经过任何代理",
    system: "系统代理",
    systemDescription: "使用系统配置的代理设置",
    custom: "自定义代理",
    customDescription: "手动配置代理服务器",
    host: "代理地址",
    hostPlaceholder: "127.0.0.1",
    port: "端口",
    portPlaceholder: "7890",
    example: "示例",
    testConnection: "测试连接",
    saveSettings: "保存设置",
    infoTip1: "提示：修改代理设置后，需要重新加载网页才能生效。",
    infoTip2: "常见代理端口：HTTP/HTTPS 代理通常使用 7890、8080、1080 等端口。",
    saveSuccess: "代理设置已保存",
    saveFailed: "保存失败，请重试",
    testInProgress: "代理测试功能开发中...",
  },

  translationSettings: {
    title: "翻译设置",
    description: "配置翻译功能",
    defaultTranslator: "默认翻译引擎",
    selectTranslator: "选择翻译引擎",
  },

  about: {
    title: "关于",
    version: "版本",
    description: "一个简洁高效的AI问答助手",
    features: "主要功能",
    feature1: "多AI平台支持",
    feature2: "智能翻译功能",
    feature3: "灵活配置选项",
    feature4: "简洁优雅界面",
    openSource: "开源项目",
    license: "本项目采用 MIT 开源协议",
    visitRepository: "访问 GitHub 仓库",
    copyright: "保留所有权利",
  },

  chat: {
    loading: "加载中...",
    loadError: "加载失败",
    loadErrorMessage: "无法加载页面，请检查网络连接或代理设置",
    reload: "重新加载",
    selectPlatform: "请选择一个AI平台",
    embedNotSupported: "不支持应用内嵌入",
    embedNotSupportedMessage: "由于安全策略限制，{platform} 无法在应用内直接显示。",
    embedNotSupportedReason: "为什么会这样？",
    embedNotSupportedDetail: "该平台设置了 X-Frame-Options 或 Content Security Policy 限制，这是为了保护用户账号安全的标准做法。",
    openInBrowser: "在浏览器中打开 {platform}",
    retry: "重试",
    openExternal: "在浏览器中打开",
  },

  translation: {
    title: "翻译",
    selectPlatform: "选择翻译平台",
    noPlatforms: "暂无可用的翻译平台",
    noPlatformsDescription: "请在设置中添加翻译平台",
  },

  tray: {
    show: "显示",
    hide: "隐藏",
    quit: "退出",
  },

  errors: {
    networkError: "网络错误",
    loadFailed: "加载失败",
    saveFailed: "保存失败",
    unknownError: "未知错误",
  },
};

export default zhCN;
