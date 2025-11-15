<script lang="ts">
    /**
     * 通用按钮组件（移除 Tailwind 样式残留，纯 CSS 变量实现）
     */
    import type { Snippet } from "svelte";

    interface Props {
        variant?: "primary" | "secondary" | "icon" | "ghost";
        size?: "sm" | "md" | "lg";
        disabled?: boolean;
        loading?: boolean;
        class?: string;
        type?: "button" | "submit" | "reset";
        onclick?: (_event: MouseEvent) => void;
        children?: Snippet;
        ariaLabel?: string; // 方便传递可访问性标签
        title?: string; // 可选的 title 属性
    }

    let {
        variant = "primary",
        size = "md",
        disabled = false,
        loading = false,
        class: className = "",
        type = "button",
        onclick,
        children,
        ariaLabel,
        title,
    }: Props = $props();

    // 映射到语义 class（避免使用不存在的原 Tailwind 工具类）
    const sizeClasses: Record<string, string> = {
        sm: "btn-sm",
        md: "btn-md",
        lg: "btn-lg",
    };

    const variantClasses: Record<string, string> = {
        primary: "btn-primary",
        secondary: "btn-secondary",
        icon: "btn-icon",
        ghost: "btn-ghost",
    };
</script>

<button
    {type}
    class="btn {variantClasses[variant]} {sizeClasses[size]} {className}"
    disabled={disabled || loading}
    onclick={onclick}
    aria-label={ariaLabel}
    title={title}
>
    {#if loading}
        <svg
            class="spinner-icon"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
        >
            <circle
                class="spinner-circle"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
            ></circle>
            <path
                class="spinner-path"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
        </svg>
    {/if}

    {#if children}
        {@render children()}
    {/if}
</button>

<style>
    /* 基础按钮结构使用全局 .btn，但这里可补充尺寸与变体细节 */
    .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        font-weight: 500;
        border: none;
        cursor: pointer;
        user-select: none;
        transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
        color: var(--text-primary);
        background: transparent;
        border-radius: 0.5rem;
    }

    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* 尺寸 */
    .btn-sm {
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
        line-height: 1rem;
    }

    .btn-md {
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        line-height: 1.25rem;
    }

    .btn-lg {
        padding: 0.75rem 1.25rem;
        font-size: 1rem;
        line-height: 1.375rem;
    }

    /* 变体 */
    .btn-primary {
        background-color: var(--accent-color);
        color: #fff;
    }
    .btn-primary:hover:not(:disabled) {
        background-color: var(--accent-hover);
    }

    .btn-secondary {
        background-color: var(--bg-secondary);
        color: var(--text-primary);
    }
    .btn-secondary:hover:not(:disabled) {
        background-color: var(--bg-tertiary);
    }

    .btn-icon {
        padding: 0.375rem;
        width: auto;
        height: auto;
        color: var(--text-secondary);
    }
    .btn-icon:hover:not(:disabled) {
        background-color: var(--bg-secondary);
        color: var(--text-primary);
    }

    .btn-ghost {
        background: transparent;
        color: var(--text-secondary);
    }
    .btn-ghost:hover:not(:disabled) {
        background-color: var(--bg-secondary);
        color: var(--text-primary);
    }

    /* 加载动画图标统一尺寸 */
    .spinner-icon {
        width: 1rem;
        height: 1rem;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }
</style>
