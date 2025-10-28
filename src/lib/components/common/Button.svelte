<script lang="ts">
  /**
   * 通用按钮组件
   */
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'icon' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    loading?: boolean;
    class?: string;
    type?: 'button' | 'submit' | 'reset';
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    class: className = '',
    type = 'button',
    onclick,
    children
  }: Props = $props();

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  };

  const variantClasses = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'bg-bg-secondary text-text-primary hover:bg-bg-tertiary',
    icon: 'p-2 hover:bg-bg-secondary',
    ghost: 'hover:bg-bg-secondary'
  };
</script>

<button
  {type}
  class="btn transition-all rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 {variantClasses[variant]} {sizeClasses[size]} {className}"
  disabled={disabled || loading}
  onclick={onclick}
>
  {#if loading}
    <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  {/if}

  {#if children}
    {@render children()}
  {/if}
</button>

<style>
  button {
    color: var(--text-primary);
  }

  .bg-accent {
    background-color: var(--accent-color);
  }

  .bg-accent:hover:not(:disabled) {
    background-color: var(--accent-hover);
  }

  .bg-bg-secondary {
    background-color: var(--bg-secondary);
  }

  .bg-bg-secondary:hover:not(:disabled) {
    background-color: var(--bg-tertiary);
  }

  .bg-bg-tertiary {
    background-color: var(--bg-tertiary);
  }

  .text-text-primary {
    color: var(--text-primary);
  }

  .focus\:ring-accent:focus {
    --tw-ring-color: var(--accent-color);
  }
</style>
