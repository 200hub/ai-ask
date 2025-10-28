/**
 * 한국어 번역
 */

export const koKR = {
    common: {
        confirm: "확인",
        cancel: "취소",
        save: "저장",
        delete: "삭제",
        edit: "편집",
        add: "추가",
        close: "닫기",
        back: "뒤로",
        next: "다음",
        previous: "이전",
        search: "검색",
        loading: "로딩 중...",
        success: "성공",
        error: "오류",
        warning: "경고",
        info: "정보",
        yes: "예",
        no: "아니오",
    },

    app: {
        name: "AI Ask",
        title: "AI 어시스턴트",
        description: "간단하고 효율적인 AI 질문 응답 어시스턴트",
    },

    sidebar: {
        platforms: "AI 플랫폼",
        translation: "번역",
        settings: "설정",
    },

    header: {
        refresh: "새로고침",
        openInBrowser: "브라우저에서 열기",
        minimize: "최소화",
        close: "닫기",
    },

    settings: {
        title: "설정",
        general: "일반",
        platforms: "AI 플랫폼",
        proxy: "프록시",
        translation: "번역",
        about: "정보",
    },

    general: {
        title: "일반 설정",
        appearance: "외관",
        theme: "테마 모드",
        themeDescription: "앱의 외관 테마 선택",
        themeSystem: "시스템 따르기",
        themeLight: "라이트",
        themeDark: "다크",
        shortcuts: "단축키",
        globalHotkey: "글로벌 단축키",
        globalHotkeyDescription: "창 표시/숨기기",
        translationHotkey: "번역 단축키",
        translationHotkeyDescription: "번역 기능 빠른 접근",
        startup: "시작",
        autoStart: "시작 시 자동 실행",
        autoStartDescription: "시스템 시작 시 자동으로 실행",
        infoTip1: "앱을 닫으면 종료되지 않고 시스템 트레이로 최소화됩니다.",
        infoTip2: "트레이 아이콘을 우클릭하고 '종료'를 선택하면 완전히 닫을 수 있습니다.",
    },

    platforms: {
        title: "AI 플랫폼 관리",
        description: "AI 플랫폼 관리 및 구성",
        addPlatform: "플랫폼 추가",
        editPlatform: "플랫폼 편집",
        noPlatforms: "플랫폼 없음",
        noPlatformsDescription: "아래 버튼을 클릭하여 AI 플랫폼 추가",
        name: "플랫폼 이름",
        namePlaceholder: "예: ChatGPT",
        url: "플랫폼 URL",
        urlPlaceholder: "https://",
        icon: "아이콘 URL",
        iconPlaceholder: "https://",
        enabled: "활성화",
        disabled: "비활성화",
        dragToReorder: "드래그하여 순서 변경",
        required: "필수 항목",
        invalidUrl: "유효한 URL을 입력하세요",
    },

    proxy: {
        title: "네트워크 프록시",
        description: "네트워크 프록시 설정 구성",
        type: "프록시 유형",
        none: "프록시 없음",
        noneDescription: "프록시 없이 직접 연결",
        system: "시스템 프록시",
        systemDescription: "시스템 구성 프록시 설정 사용",
        custom: "사용자 정의 프록시",
        customDescription: "프록시 서버 수동 구성",
        host: "프록시 주소",
        hostPlaceholder: "127.0.0.1",
        port: "포트",
        portPlaceholder: "7890",
        example: "예시",
        testConnection: "연결 테스트",
        saveSettings: "설정 저장",
        infoTip1: "팁: 프록시 설정을 수정한 후 변경 사항을 적용하려면 웹 페이지를 다시 로드해야 합니다.",
        infoTip2: "일반적인 프록시 포트: HTTP/HTTPS 프록시는 일반적으로 7890, 8080, 1080과 같은 포트를 사용합니다.",
        saveSuccess: "프록시 설정이 저장되었습니다",
        saveFailed: "저장 실패, 다시 시도하세요",
        testInProgress: "프록시 테스트 기능은 개발 중입니다...",
    },

    translationSettings: {
        title: "번역 설정",
        description: "번역 기능 구성",
        defaultTranslator: "기본 번역 엔진",
        selectTranslator: "번역 엔진 선택",
    },

    about: {
        title: "정보",
        version: "버전",
        description: "간단하고 효율적인 AI 질문 응답 어시스턴트",
        features: "주요 기능",
        feature1: "다중 AI 플랫폼 지원",
        feature2: "스마트 번역",
        feature3: "유연한 구성 옵션",
        feature4: "깔끔하고 우아한 UI",
        openSource: "오픈 소스",
        license: "이 프로젝트는 MIT 라이선스에 따라 라이선스가 부여됩니다",
        visitRepository: "GitHub 저장소 방문",
        copyright: "All Rights Reserved",
    },

    chat: {
        loading: "로딩 중...",
        loadError: "로드 실패",
        loadErrorMessage: "페이지를 로드할 수 없습니다. 네트워크 연결 또는 프록시 설정을 확인하세요",
        reload: "다시 로드",
        selectPlatform: "AI 플랫폼을 선택하세요",
        embedNotSupported: "앱 내 임베딩 미지원",
        embedNotSupportedMessage: "보안 정책 제한으로 인해 {platform}은(는) 앱 내에서 직접 표시할 수 없습니다.",
        embedNotSupportedReason: "왜 이런 일이 발생하나요?",
        embedNotSupportedDetail: "이 플랫폼은 사용자 계정 보안을 보호하기 위해 X-Frame-Options 또는 Content Security Policy 제한을 설정했습니다.",
        openInBrowser: "브라우저에서 {platform} 열기",
        retry: "재시도",
        openExternal: "브라우저에서 열기",
    },

    translation: {
        title: "번역",
        selectPlatform: "번역 플랫폼 선택",
        noPlatforms: "사용 가능한 번역 플랫폼이 없습니다",
        noPlatformsDescription: "설정에서 번역 플랫폼을 추가하세요",
    },

    tray: {
        show: "표시",
        hide: "숨기기",
        quit: "종료",
    },

    errors: {
        networkError: "네트워크 오류",
        loadFailed: "로드 실패",
        saveFailed: "저장 실패",
        unknownError: "알 수 없는 오류",
    },
};

export default koKR;
