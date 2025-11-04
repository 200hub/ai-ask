<script lang="ts">
    /**
     * 关于页面组件
     */
    import { APP_INFO } from "$lib/utils/constants";
    import { open } from "@tauri-apps/plugin-shell";
    import { i18n } from "$lib/i18n";
    import { logger } from "$lib/utils/logger";

    const t = i18n.t;

    /**
     * 打开GitHub仓库
     */
    async function openRepository() {
        try {
            await open(APP_INFO.repository);
        } catch (error) {
            logger.error("Failed to open repository", error);
        }
    }

</script>

<div class="about-section">
    <!-- 应用信息 -->
    <div class="app-info-card">
        <div class="app-logo">
            <svg
                class="logo-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M12 2L2 7L12 12L22 7L12 2Z"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
                <path
                    d="M2 17L12 22L22 17"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
                <path
                    d="M2 12L12 17L22 12"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </div>
        <h1 class="app-name">{APP_INFO.name}</h1>
        <p class="app-version">{t("about.version")}: {APP_INFO.version}</p>
        <p class="app-description">{t("about.description")}</p>
    </div>

    <!-- 功能特性 -->
    <div class="info-card">
        <h3 class="card-title">{t("about.features")}</h3>
        <div class="features-list">
            <div class="feature-item">
                <span class="feature-icon">🤖</span>
                <span class="feature-text">{t("about.feature1")}</span>
            </div>
            <div class="feature-item">
                <span class="feature-icon">🌐</span>
                <span class="feature-text">{t("about.feature2")}</span>
            </div>
            <div class="feature-item">
                <span class="feature-icon">⚙️</span>
                <span class="feature-text">{t("about.feature3")}</span>
            </div>
            <div class="feature-item">
                <span class="feature-icon">🎨</span>
                <span class="feature-text">{t("about.feature4")}</span>
            </div>
        </div>
    </div>

    <!-- 开源信息 -->
    <div class="info-card">
        <h3 class="card-title">{t("about.openSource")}</h3>
        <div class="opensource-info">
            <p class="info-text">{t("about.license")}</p>
            <button class="link-btn" onclick={openRepository}>
                <svg
                    class="link-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                </svg>
                {t("about.visitRepository")}
            </button>
        </div>
    </div>

    <!-- 版权信息 -->
    <div class="copyright">
        <p>© 2025 {APP_INFO.name}. {t("about.copyright")}.</p>
    </div>
</div>

<style>
    .about-section {
        width: 100%;
        max-width: none;
    }

    .app-info-card {
        text-align: center;
        padding: 1.5rem;
        background: linear-gradient(
            135deg,
            var(--bg-secondary) 0%,
            var(--bg-primary) 100%
        );
        border-radius: 0.75rem;
        margin-bottom: 1rem;
    }

    .app-logo {
        width: 64px;
        height: 64px;
        margin: 0 auto 0.75rem;
        background: linear-gradient(
            135deg,
            var(--accent-color) 0%,
            #8b5cf6 100%
        );
        border-radius: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-lg);
    }

    .logo-icon {
        width: 40px;
        height: 40px;
        color: white;
    }

    .app-name {
        font-size: 1.75rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 0.375rem 0;
        background: linear-gradient(
            135deg,
            var(--accent-color) 0%,
            #8b5cf6 100%
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .app-version {
        font-size: 0.9375rem;
        color: var(--text-secondary);
        margin: 0 0 0.75rem 0;
    }

    .app-description {
        font-size: 0.9375rem;
        color: var(--text-secondary);
        margin: 0;
        line-height: 1.5;
    }

    .info-card {
        background-color: var(--bg-secondary);
        border-radius: 0.625rem;
        padding: 1rem;
        margin-bottom: 1rem;
        border: 1px solid var(--border-color);
    }

    .card-title {
        font-size: 1.0625rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.75rem 0;
        padding-bottom: 0.375rem;
        border-bottom: 1px solid var(--border-color);
    }

    .opensource-info {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .info-text {
        font-size: 0.9375rem;
        color: var(--text-primary);
        margin: 0;
    }

    .link-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1.25rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: white;
        background-color: var(--accent-color);
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
        align-self: flex-start;
    }

    .link-btn:hover {
        background-color: var(--accent-hover);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
    }

    .link-icon {
        width: 16px;
        height: 16px;
    }

    .features-list {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.75rem;
    }

    .feature-item {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.625rem;
        background-color: var(--bg-primary);
        border-radius: 0.375rem;
        border: 1px solid var(--border-color);
    }

    .feature-icon {
        font-size: 1.375rem;
    }

    .feature-text {
        font-size: 0.875rem;
        color: var(--text-primary);
        font-weight: 500;
    }

    .copyright {
        text-align: center;
        padding: 0.75rem 0;
    }

    .copyright p {
        font-size: 0.8125rem;
        color: var(--text-tertiary);
        margin: 0;
    }

    /* 响应式设计 */
    @media (max-width: 768px) {
        .app-info-card {
            padding: 1.25rem;
        }

        .app-name {
            font-size: 1.375rem;
        }

        .features-list {
            grid-template-columns: 1fr;
        }
    }
</style>
