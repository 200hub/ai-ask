<script lang="ts">
    /**
     * 加载动画组件
     */
    interface Props {
        size?: 'small' | 'medium' | 'large';
        message?: string;
    }
    
    let { size = 'medium', message }: Props = $props();
    
    const sizeMap = {
        small: '24px',
        medium: '40px',
        large: '56px'
    };
</script>

<div class="loading-spinner" class:has-message={message}>
    <div class="spinner" style="width: {sizeMap[size]}; height: {sizeMap[size]};">
        <svg class="circular" viewBox="25 25 50 50">
            <circle
                class="path"
                cx="50"
                cy="50"
                r="20"
                fill="none"
                stroke-width="3"
                stroke-miterlimit="10"
            />
        </svg>
    </div>
    {#if message}
        <p class="loading-message">{message}</p>
    {/if}
</div>

<style>
    .loading-spinner {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
    }

    .spinner {
        animation: rotate 2s linear infinite;
    }

    .circular {
        animation: dash 1.5s ease-in-out infinite;
    }

    .path {
        stroke: var(--accent-color);
        stroke-linecap: round;
    }

    @keyframes rotate {
        100% {
            transform: rotate(360deg);
        }
    }

    @keyframes dash {
        0% {
            stroke-dasharray: 1, 150;
            stroke-dashoffset: 0;
        }
        50% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -35;
        }
        100% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -124;
        }
    }

    .loading-message {
        margin: 0;
        color: var(--text-secondary);
        font-size: 0.875rem;
        font-weight: 500;
    }

    .loading-spinner.has-message {
        gap: 0.75rem;
    }
</style>
