/**
 * 日本語翻訳
 */

export const jaJP = {
    common: {
        confirm: "確認",
        cancel: "キャンセル",
        save: "保存",
        delete: "削除",
        edit: "編集",
        add: "追加",
        close: "閉じる",
        back: "戻る",
        next: "次へ",
        previous: "前へ",
        search: "検索",
        loading: "読み込み中...",
        success: "成功",
        error: "エラー",
        warning: "警告",
        info: "情報",
        yes: "はい",
        no: "いいえ",
    },

    app: {
        name: "AI Ask",
        title: "AIアシスタント",
        description: "シンプルで効率的なAI質問応答アシスタント",
    },

    sidebar: {
        platforms: "AIプラットフォーム",
        translation: "翻訳",
        settings: "設定",
    },

    header: {
        refresh: "更新",
        openInBrowser: "ブラウザで開く",
        minimize: "最小化",
        close: "閉じる",
    },

    settings: {
        title: "設定",
        general: "一般",
        platforms: "AIプラットフォーム",
        proxy: "プロキシ",
        translation: "翻訳",
        about: "について",
    },

    general: {
        title: "一般設定",
        appearance: "外観",
        theme: "テーマモード",
        themeDescription: "アプリの外観テーマを選択",
        themeSystem: "システムに従う",
        themeLight: "ライト",
        themeDark: "ダーク",
        shortcuts: "ショートカット",
        globalHotkey: "グローバルホットキー",
        globalHotkeyDescription: "ウィンドウの表示/非表示",
        translationHotkey: "翻訳ホットキー",
        translationHotkeyDescription: "翻訳機能へのクイックアクセス",
        startup: "スタートアップ",
        autoStart: "自動起動",
        autoStartDescription: "システム起動時に自動的に実行",
        infoTip1: "アプリを閉じると、終了せずにシステムトレイに最小化されます。",
        infoTip2: "トレイアイコンを右クリックして「終了」を選択すると、完全に閉じることができます。",
    },

    platforms: {
        title: "AIプラットフォーム管理",
        description: "AIプラットフォームの管理と設定",
        addPlatform: "プラットフォームを追加",
        editPlatform: "プラットフォームを編集",
        noPlatforms: "プラットフォームがありません",
        noPlatformsDescription: "下のボタンをクリックしてAIプラットフォームを追加",
        name: "プラットフォーム名",
        namePlaceholder: "例：ChatGPT",
        url: "プラットフォームURL",
        urlPlaceholder: "https://",
        icon: "アイコンURL",
        iconPlaceholder: "https://",
        enabled: "有効",
        disabled: "無効",
        dragToReorder: "ドラッグして並び替え",
        required: "必須項目",
        invalidUrl: "有効なURLを入力してください",
    },

    proxy: {
        title: "ネットワークプロキシ",
        description: "ネットワークプロキシ設定の構成",
        type: "プロキシタイプ",
        none: "プロキシなし",
        noneDescription: "プロキシを経由せず直接接続",
        system: "システムプロキシ",
        systemDescription: "システム設定のプロキシを使用",
        custom: "カスタムプロキシ",
        customDescription: "プロキシサーバーを手動設定",
        host: "プロキシアドレス",
        hostPlaceholder: "127.0.0.1",
        port: "ポート",
        portPlaceholder: "7890",
        example: "例",
        testConnection: "接続テスト",
        saveSettings: "設定を保存",
        infoTip1: "ヒント：プロキシ設定を変更した後、変更を反映するにはウェブページを再読み込みする必要があります。",
        infoTip2: "一般的なプロキシポート：HTTP/HTTPSプロキシは通常7890、8080、1080などのポートを使用します。",
        saveSuccess: "プロキシ設定が保存されました",
        saveFailed: "保存に失敗しました。もう一度お試しください",
        testInProgress: "プロキシテスト機能は開発中です...",
    },

    translationSettings: {
        title: "翻訳設定",
        description: "翻訳機能の設定",
        defaultTranslator: "デフォルト翻訳エンジン",
        selectTranslator: "翻訳エンジンを選択",
    },

    about: {
        title: "について",
        version: "バージョン",
        description: "シンプルで効率的なAI質問応答アシスタント",
        features: "主な機能",
        feature1: "複数AIプラットフォーム対応",
        feature2: "スマート翻訳",
        feature3: "柔軟な設定オプション",
        feature4: "クリーンでエレガントなUI",
        openSource: "オープンソース",
        license: "このプロジェクトはMITライセンスの下でライセンスされています",
        visitRepository: "GitHubリポジトリを訪問",
        copyright: "All Rights Reserved",
    },

    chat: {
        loading: "読み込み中...",
        loadError: "読み込み失敗",
        loadErrorMessage: "ページを読み込めません。ネットワーク接続またはプロキシ設定を確認してください",
        reload: "再読み込み",
        selectPlatform: "AIプラットフォームを選択してください",
    },

    translation: {
        title: "翻訳",
        selectPlatform: "翻訳プラットフォームを選択",
        noPlatforms: "利用可能な翻訳プラットフォームがありません",
        noPlatformsDescription: "設定で翻訳プラットフォームを追加してください",
    },

    tray: {
        show: "表示",
        hide: "非表示",
        quit: "終了",
    },

    errors: {
        networkError: "ネットワークエラー",
        loadFailed: "読み込み失敗",
        saveFailed: "保存失敗",
        unknownError: "未知のエラー",
    },
};

export default jaJP;
