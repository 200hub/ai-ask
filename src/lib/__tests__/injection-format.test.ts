// 测试：injection-format 模块的内容格式化与 Markdown 转换逻辑
// 覆盖点：
// 1. 纯文本格式保留
// 2. HTML -> Markdown（粗体、标题、表格）
// 3. 代码块围栏化与语言检测（多平台结构）
// 4. 回退策略（HTML 缺失时使用文本）
// 5. 交互元素（按钮）清理是否生效
import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/utils/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { formatExtractedContent, getExtractedDisplayText } from "$lib/utils/injection-format";

describe("injection-format helpers", () => {
  it("keeps plain text when no markdown requested", () => {
    const formatted = formatExtractedContent({
      success: true,
      content: "hello world",
      format: "text",
    });

    expect(formatted).toEqual({
      format: "text",
      text: "hello world",
      markdown: undefined,
      html: undefined,
    });
  });

  it("converts html to markdown when requested", () => {
    const formatted = formatExtractedContent({
      success: true,
      content: "",
      html: "<p><strong>bold</strong> text</p>",
      format: "markdown",
    });

    expect(formatted?.markdown).toBe("**bold** text");
    expect(formatted?.text).toBe("");
    const output = getExtractedDisplayText({
      format: "markdown",
      content: "",
      html: "<h1>Title</h1><p>Body</p>",
    });
    expect(output).toContain("# Title");
  });

  it("converts html tables to pipe-style markdown", () => {
    const html = `
			<table>
				<thead>
					<tr><th>Name</th><th>Score</th></tr>
				</thead>
				<tbody>
					<tr><td>Alice</td><td>95</td></tr>
					<tr><td>Bob</td><td>88</td></tr>
				</tbody>
			</table>
		`;

    const display = getExtractedDisplayText({
      format: "markdown",
      content: "",
      html,
    });

    expect(display).toContain("| Name | Score |");
    expect(display).toContain("| Alice | 95 |");
    // Ensure divider row inserted
    expect(display).toMatch(/\|\s*-{3,}\s*\|/);
  });

  it("converts nested pre/code blocks with language to fenced markdown", () => {
    const codeBody = 'def greet(name):\n    print(f"Hello, {name}!")';
    const html = `
			<pre class="overflow-visible!" data-start="359" data-end="418">
				<div class="contain-inline-size rounded-2xl relative bg-token-sidebar-surface-primary">
					<div class="flex items-center text-token-text-secondary px-4 py-2 text-xs font-sans justify-between h-9 bg-token-sidebar-surface-primary select-none rounded-t-2xl">python</div>
					<div class="sticky top-9">
						<div class="absolute end-0 bottom-0 flex h-9 items-center pe-2">
							<div class="bg-token-bg-elevated-secondary text-token-text-secondary flex items-center gap-4 rounded-sm px-2 font-sans text-xs">
								<button class="flex gap-1 items-center select-none py-1" aria-label="复制">复制代码</button>
							</div>
						</div>
					</div>
					<div class="overflow-y-auto p-4" dir="ltr">
						<code class="whitespace-pre! language-python">
							<span>${codeBody}</span>
						</code>
					</div>
				</div>
			</pre>
		`;

    const output = getExtractedDisplayText({
      format: "markdown",
      content: "",
      html,
    });

    expect(output).toContain("```python");
    expect(output).toContain("def greet(name):");
    expect(output).toContain('print(f"Hello, {name}!")');
    expect(output.trim().endsWith("```")).toBe(true);
  });

  it("extracts language labels from Gemini style components", () => {
    const html = `
			<code-block class="ng-star-inserted">
				<div class="code-block-decoration header-formatted gds-title-s">
					<span>Java</span>
					<div class="buttons">
						<button aria-label="复制代码">复制代码</button>
					</div>
				</div>
				<div class="formatted-code-block-internal-container">
					<div class="animated-opacity">
						<pre>
							<code role="text" data-test-id="code-content" class="code-container formatted">
								<span class="hljs-keyword">public</span> <span class="hljs-class"><span class="hljs-keyword">class</span> <span class="hljs-title">HelloWorld</span> </span>{

									<span class="hljs-function"><span class="hljs-keyword">public</span> <span class="hljs-keyword">static</span> <span class="hljs-keyword">void</span> <span class="hljs-title">main</span><span class="hljs-params">(String[] args)</span> </span>{
										System.out.println(<span class="hljs-string">"Hello, World!"</span>);
									}
								}
							</code>
						</pre>
					</div>
				</div>
			</code-block>
		`;

    const output = getExtractedDisplayText({
      format: "markdown",
      content: "",
      html,
    });

    expect(output).toContain("```java");
    expect(output).toContain("public class HelloWorld");
    expect(output.trim().endsWith("```")).toBe(true);
  });

  it("handles md-code-block containers without nested code elements", () => {
    const html = `
			<div class="md-code-block md-code-block-dark">
				<div class="md-code-block-banner-wrap">
					<div class="md-code-block-banner md-code-block-banner-lite">
						<div class="_121d384">
							<div class="d813de27">java</div>
						</div>
					</div>
				</div>
				<pre>
					<span class="token keyword">public</span> <span class="token keyword">class</span> <span class="token class-name">HelloWorld</span> <span class="token punctuation">{</span>
						<span class="token keyword">public</span> <span class="token keyword">static</span> <span class="token keyword">void</span> <span class="token function">main</span><span class="token punctuation">(</span><span class="token class-name">String</span><span class="token punctuation">[]</span> args<span class="token punctuation">)</span> <span class="token punctuation">{</span>
							<span class="token class-name">System</span><span class="token punctuation">.</span>out<span class="token punctuation">.</span><span class="token function">println</span><span class="token punctuation">(</span><span class="token string">"Hello, World!"</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
						<span class="token punctuation">}</span>
					<span class="token punctuation">}</span>
				</pre>
			</div>
		`;

    const output = getExtractedDisplayText({
      format: "markdown",
      content: "",
      html,
    });

    expect(output).toContain("```java");
    expect(output).toContain('System.out.println("Hello, World!");');
    expect(output.trim().endsWith("```")).toBe(true);
  });

  it("ignores button-only labels when detecting language", () => {
    const html = `
			<div class="code-block">
				<div class="header">
					<button>java</button>
				</div>
				<pre>
					code without class
				</pre>
			</div>
		`;

    const output = getExtractedDisplayText({
      format: "markdown",
      content: "",
      html,
    });

    expect(output).toContain("```");
    expect(output).not.toContain("```java");
  });

  it("removes interactive buttons from markdown output", () => {
    const html = `
			<div class="md-code-block md-code-block-dark">
				<div class="md-code-block-banner-wrap">
					<div class="md-code-block-banner md-code-block-banner-lite">
						<div class="_121d384">
							<div class="d2a24f03">
								<span class="d813de27">rust</span>
							</div>
							<div class="d2a24f03 _246a029">
								<div class="efa13877">
									<button role="button" aria-label="复制">
										<span class="code-info-button-text">复制</span>
									</button>
									<button role="button" aria-label="下载">
										<span class="code-info-button-text">下载</span>
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
				<pre>
					<span class="token keyword">fn</span> <span class="token function">main</span>() {}
				</pre>
			</div>
		`;

    const output = getExtractedDisplayText({
      format: "markdown",
      content: "",
      html,
    });

    expect(output).toContain("```rust");
    expect(output).not.toMatch(/复制|下载/);
  });

  it("falls back to text when html missing for markdown format", () => {
    const display = getExtractedDisplayText({
      format: "markdown",
      content: "fallback text",
    });

    expect(display).toBe("fallback text");
  });
});
