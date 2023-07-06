import { MarkdownSectionInformation, CachedMetadata, sanitizeHTMLToDom, FrontMatterCache } from "obsidian";

import CodeblockCustomizerPlugin from "./main";
import { PRIMARY_DELAY, SECONDARY_DELAY } from "./Settings";
import { CodeblockParameters, getFileContentLines, isExcluded, parseCodeblockSource } from "./CodeblockParsing";
import { createHeader, getLineClass } from "./CodeblockDecorating";

export async function readingViewPostProcessor(element: HTMLElement, {sourcePath,getSectionInfo,frontmatter}: {sourcePath: string, getSectionInfo: (element: HTMLElement) => MarkdownSectionInformation | null, frontmatter: FrontMatterCache | undefined}, plugin: CodeblockCustomizerPlugin, editingEmbeds: boolean = false) {
	const cache: CachedMetadata | null = plugin.app.metadataCache.getCache(sourcePath);
	if (sourcePath === '' || (frontmatter ?? cache?.frontmatter)?.['codeblock-customizer-ignore'] === true)
		return;
	
	await sleep(50);
	// const view: MarkdownView | null = plugin.app.workspace.getActiveViewOfType(MarkdownView); //todo
	// if (!element && view) //todo
	if (!element) //todo
		console.log('oh no!',element) //todo
		// element = view.contentEl; //todo
	let codeblockPreElements: Array<HTMLElement>;
	editingEmbeds = editingEmbeds || Boolean(element.matchParent(".cm-embed-block"));
	const specific = !element.querySelector(".view-content > *");

	if (!editingEmbeds && !specific)
		codeblockPreElements = Array.from(element.querySelectorAll('.markdown-reading-view pre:not(.frontmatter)'));
	else if (!editingEmbeds && specific)
		codeblockPreElements = Array.from(element.querySelectorAll('pre:not(.frontmatter)'));
	else if (editingEmbeds && !specific)
		codeblockPreElements = Array.from(element.querySelectorAll('.markdown-source-view .cm-embed-block pre:not(.frontmatter)'));
	else
		codeblockPreElements = [];
	if (codeblockPreElements.length === 0 && !(editingEmbeds && specific))
		return;

	if (!editingEmbeds) {
		const readingViewParent = element.matchParent('.view-content > .markdown-reading-view > .markdown-preview-view > .markdown-preview-section');
		if (readingViewParent)
			plugin.readingStylingMutationObserver.observe(readingViewParent,{
				childList: true,
				attributes: false,
				characterData: false,
				subtree: false,
			})
	}

	const codeblockSectionInfo: MarkdownSectionInformation | null= getSectionInfo(codeblockPreElements[0]);
	if (codeblockSectionInfo && specific && !editingEmbeds)
		renderSpecificReadingSection(codeblockPreElements,sourcePath,codeblockSectionInfo,plugin);
	else if (specific) {
		if (!(!editingEmbeds && element.classList.contains("admonition-content")))
			await readingViewPostProcessor(element.matchParent('.view-content') as HTMLElement,{sourcePath,getSectionInfo,frontmatter},plugin,editingEmbeds); // Re-render whole document
	}
	else
		renderDocument(codeblockPreElements,sourcePath,cache,editingEmbeds,plugin);
}
async function renderSpecificReadingSection(codeblockPreElements: Array<HTMLElement>, sourcePath: string, codeblockSectionInfo: MarkdownSectionInformation, plugin: CodeblockCustomizerPlugin): Promise<void> {
	const fileContentLines = await getFileContentLines(sourcePath,plugin);
	if (!fileContentLines)
		return;
	const codeblocksParameters = (await parseCodeblockSource(Array.from({length: codeblockSectionInfo.lineEnd-codeblockSectionInfo.lineStart+1}, (_,num) => num + codeblockSectionInfo.lineStart).map((lineNumber)=>fileContentLines[lineNumber]),sourcePath,plugin)).codeblocksParameters;
	for (let [key,codeblockPreElement] of codeblockPreElements.entries()) {
		let codeblockParameters = codeblocksParameters[key];
		let codeblockCodeElement = codeblockPreElement.querySelector('pre > code');
		if (!codeblockCodeElement)
			return;
		if (Array.from(codeblockCodeElement.classList).some(className => /^language-\S+/.test(className)))
			while(!codeblockCodeElement.classList.contains("is-loaded"))
				await sleep(2);
		if (isExcluded(codeblockParameters.language,plugin.settings.excludedLanguages) || codeblockParameters.ignore)
			continue;
		await remakeCodeblock(codeblockCodeElement as HTMLElement,codeblockPreElement,codeblockParameters,plugin);
	}
}
async function renderDocument(codeblockPreElements: Array<HTMLElement>, sourcePath: string, cache: CachedMetadata | null, editingEmbeds: boolean, plugin: CodeblockCustomizerPlugin) {
	const fileContentLines = await getFileContentLines(sourcePath,plugin);
	if (!fileContentLines)
		return;
	let codeblocksParameters: Array<CodeblockParameters> = [];

	if (typeof cache?.sections !== 'undefined') {
		for (const section of cache.sections) {
			if (!editingEmbeds || section.type === 'code' || section.type === 'callout') {
				const parsedCodeblocksParameters = await parseCodeblockSource(fileContentLines.slice(section.position.start.line,section.position.end.line+1),sourcePath,plugin);
				if (!editingEmbeds || parsedCodeblocksParameters.nested)
					codeblocksParameters = codeblocksParameters.concat(parsedCodeblocksParameters.codeblocksParameters);
			}
		}
	} else {
		console.error(`Metadata cache not found for file: ${sourcePath}`);
		return;
	}
	if (codeblockPreElements.length !== codeblocksParameters.length)
		return;
	try {
		for (let [key,codeblockPreElement] of Array.from(codeblockPreElements).entries()) {
			let codeblockParameters = codeblocksParameters[key];
			let codeblockCodeElement: HTMLPreElement | null = codeblockPreElement.querySelector("pre > code");
			if (!codeblockCodeElement)
				return;
			if (Array.from(codeblockCodeElement.classList).some(className => /^language-\S+/.test(className)))
				while(!codeblockCodeElement.classList.contains("is-loaded"))
					await sleep(2);
			if (codeblockCodeElement.querySelector("code [class*='codeblock-customizer-line']"))
				continue;
			if (isExcluded(codeblockParameters.language,plugin.settings.excludedLanguages) || codeblockParameters.ignore)
				continue;
			await remakeCodeblock(codeblockCodeElement,codeblockPreElement,codeblockParameters,plugin);
		}
	} catch (error) {
		console.error(`Error rendering document: ${error.message}`);
		return;
	}
}

async function remakeCodeblock(codeblockCodeElement: HTMLElement, codeblockPreElement: HTMLElement, codeblockParameters: CodeblockParameters, plugin: CodeblockCustomizerPlugin) {
	// Add Execute Code Observer
	plugin.executeCodeMutationObserver.observe(codeblockPreElement,{
		childList: true,
		subtree: true,
		attributes: true,
		characterData: true,
	});

	// Add Parent Classes
	codeblockPreElement.classList.add(`codeblock-customizer-pre`);
	if (codeblockParameters.language)
		codeblockPreElement.classList.add(`language-${codeblockParameters.language}`);
	if (codeblockPreElement.parentElement)
		codeblockPreElement.parentElement.classList.add(`codeblock-customizer-pre-parent`);

	// Create Header
	const headerContainer = createHeader(codeblockParameters, plugin.settings.currentTheme.settings,plugin.languageIcons);
	codeblockPreElement.insertBefore(headerContainer, codeblockPreElement.childNodes[0]);
	
	// Add listener for header collapsing on click
	headerContainer.addEventListener("click", ()=>{
		codeblockPreElement.classList.toggle("codeblock-customizer-codeblock-collapsed")
		if (codeblockCodeElement.style.maxHeight)
			codeblockCodeElement.style.maxHeight = '';
		else
			codeblockCodeElement.style.maxHeight = 'var(--true-height)';
		const executeCodeOutput = (codeblockPreElement.querySelector('pre > code ~ code.language-output') as HTMLElement);
		if (executeCodeOutput && executeCodeOutput.style.display !== 'none') {
			if (executeCodeOutput.style.maxHeight)
				executeCodeOutput.style.maxHeight = '';
			else
				executeCodeOutput.style.maxHeight = 'var(--true-height)';
		}
	});

	// Line Wrapping Classes
	if (codeblockParameters.lineUnwrap.alwaysEnabled) {
		codeblockCodeElement.style.setProperty('--line-wrapping','pre');
		if (codeblockParameters.lineUnwrap.activeWrap)
			codeblockCodeElement.style.setProperty('--line-active-wrapping','pre-wrap');
		else
			codeblockCodeElement.style.setProperty('--line-active-wrapping','pre');
	} else if (codeblockParameters.lineUnwrap.alwaysDisabled)
		codeblockCodeElement.style.setProperty('--line-wrapping','pre-wrap');

	// Height Setting (for collapse animation) - Delay to return correct height
	setTimeout(()=>{setCollapseStyling(codeblockPreElement,codeblockCodeElement,codeblockParameters.fold.enabled)},PRIMARY_DELAY);

	//todo (@mayurankv) Name section
	if (codeblockCodeElement.querySelector("code [class*='codeblock-customizer-line']"))
		return;

	//todo (@mayurankv) Name section
	let codeblockLines = codeblockCodeElement.innerHTML.split("\n");
	if (codeblockLines.length == 1)
		codeblockLines = ['',''];
	codeblockCodeElement.innerHTML = "";
	codeblockLines.forEach((line,index) => {
		if (index === codeblockLines.length-1)
			return;
		const lineNumber = index + 1;
		const lineWrapper = document.createElement("div");
		getLineClass(codeblockParameters,lineNumber,line).forEach((lineClass) => {
			lineWrapper.classList.add(lineClass);
		});
		codeblockCodeElement.appendChild(lineWrapper);
		let lineNumberDisplay = '';
		if (!codeblockParameters.lineNumbers.alwaysEnabled && codeblockParameters.lineNumbers.alwaysDisabled)
			lineNumberDisplay = '-hide'
		else if (codeblockParameters.lineNumbers.alwaysEnabled && !codeblockParameters.lineNumbers.alwaysDisabled)
			lineNumberDisplay = '-specific'
		lineWrapper.appendChild(createDiv({cls: `codeblock-customizer-line-number${lineNumberDisplay}`, text: (lineNumber+codeblockParameters.lineNumbers.offset).toString()}));
		lineWrapper.appendChild(createDiv({cls: `codeblock-customizer-line-text`, text: sanitizeHTMLToDom(line !== "" ? line : "<br>")}));
	});

	// Set line number margin - Delay to return correct width
	// setTimeout(()=>{setLineNumberMargin(codeblockPreElement,codeblockCodeElement)},SECONDARY_DELAY);
}
export function remeasureReadingView(element: HTMLElement, primary_delay: number = PRIMARY_DELAY, secondary_delay: number = SECONDARY_DELAY): void {
	const codeblockPreElements = element.querySelectorAll('pre:not(.frontmatter)');
	codeblockPreElements.forEach((codeblockPreElement: HTMLElement)=>{
		let codeblockCodeElement = codeblockPreElement.querySelector('pre > code') as HTMLElement;
		if (!codeblockCodeElement)
			return;
		setTimeout(()=>{setCollapseStyling(codeblockPreElement,codeblockCodeElement,codeblockPreElement.classList.contains('codeblock-customizer-codeblock-collapsed'))},primary_delay);
	})
}
function setCollapseStyling(codeblockPreElement: HTMLElement, codeblockCodeElement: HTMLElement, fold: boolean): void {
	codeblockCodeElement.style.setProperty('--true-height',`calc(${codeblockCodeElement.scrollHeight}px + 2 * var(--code-padding)`);
	codeblockCodeElement.style.maxHeight = 'var(--true-height)';
	codeblockCodeElement.style.whiteSpace = 'var(--line-wrapping)';
	if (fold) {
		codeblockPreElement.classList.add("codeblock-customizer-codeblock-collapsed");
		codeblockCodeElement.style.maxHeight = '';
	}
}

export function destroyReadingModeElements(): void {
	document.querySelectorAll(".codeblock-customizer-pre-parent").forEach(codeblockPreParent => {
		codeblockPreParent.classList.remove('codeblock-customizer-pre-parent');
	});
	[
		...Array.from(document.querySelectorAll("pre.codeblock-customizer-pre div[class^='codeblock-customizer-header-container']")),
		...Array.from(document.querySelectorAll("pre.codeblock-customizer-pre div[class^='codeblock-customizer-line-number']")),
	].forEach(element => element.remove());
	document.querySelectorAll("pre.codeblock-customizer-pre").forEach(codeblockPreElement => {
		codeblockPreElement.classList.remove('codeblock-customizer-pre');
		codeblockPreElement.classList.remove('codeblock-customizer-codeblock-collapsed');
		(codeblockPreElement as HTMLElement).style.removeProperty('--true-height');
		(codeblockPreElement as HTMLElement).style.removeProperty('--line-number-margin');
		(codeblockPreElement as HTMLElement).style.removeProperty('max-height');
		(codeblockPreElement as HTMLElement).style.removeProperty('white-space');
	});
	document.querySelectorAll('pre > code ~ code.language-output').forEach(executeCodeOutput => {
		executeCodeOutput.classList.remove('execute-code-output');
		(executeCodeOutput as HTMLElement).style.removeProperty('--true-height');
		(executeCodeOutput as HTMLElement).style.removeProperty('max-height');
	})
	document.querySelectorAll('pre > code:nth-of-type(1)').forEach(codeblockCodeElement => {
		(codeblockCodeElement as HTMLElement).style.removeProperty('--true-height');
		(codeblockCodeElement as HTMLElement).style.removeProperty('--line-wrapping');
		(codeblockCodeElement as HTMLElement).style.removeProperty('--line-active-wrapping');
		(codeblockCodeElement as HTMLElement).style.removeProperty('max-height');
		(codeblockCodeElement as HTMLElement).style.removeProperty('white-space');
		(codeblockCodeElement as HTMLElement).innerHTML = Array.from(codeblockCodeElement.querySelectorAll('code > [class*="codeblock-customizer-line"]')).reduce((reconstructedCodeblockLines: Array<string>, codeblockLine: HTMLElement): Array<string> => {
			const codeblockLineText = (codeblockLine.firstChild as HTMLElement);
			if (codeblockLineText)
				reconstructedCodeblockLines.push(codeblockLineText.innerHTML);
			return reconstructedCodeblockLines
		},[]).join('\n')+'\n';
	})
}

export const readingStylingMutationObserver = new MutationObserver((mutations) => {
	mutations.forEach((mutation: MutationRecord) => {
		if (mutation.addedNodes.length !== 0)
			mutation.addedNodes.forEach((addedNode: HTMLElement)=>remeasureReadingView(addedNode))
	});
});
export const executeCodeMutationObserver = new MutationObserver((mutations) => {
	mutations.forEach((mutation: MutationRecord) => {
		if (mutation.type === "attributes" && mutation.attributeName === "style" && (mutation.target as HTMLElement).tagName === 'CODE' && (mutation.target as HTMLElement).classList.contains('execute-code-output')) { // Change style of execute code output
			const executeCodeOutput = mutation.target as HTMLElement;
			if (executeCodeOutput.parentElement?.classList.contains('codeblock-customizer-codeblock-collapsed'))
				executeCodeOutput.style.maxHeight = '';
		} else if (mutation.type === "childList" && (mutation.target as HTMLElement).tagName === 'CODE' && (mutation.target as HTMLElement).classList.contains('execute-code-output')) { // Change children of execute code output
			const executeCodeOutput = mutation.target as HTMLElement;
			setTimeout(()=>{
				executeCodeOutput.style.setProperty('--true-height',`calc(${executeCodeOutput.scrollHeight}px + 3.5 * var(--code-padding) + var(--header-separator-width)`);
			},PRIMARY_DELAY)
		} else if (mutation.type === "attributes" && mutation.attributeName === "style" && (mutation.target as HTMLElement).tagName === 'INPUT' && (mutation.target as HTMLElement).parentElement?.tagName === 'CODE') { // Change style of execute code output input box
			const executeCodeOutput = mutation.target.parentElement as HTMLElement;
			if (executeCodeOutput) {
				setTimeout(()=>{
					executeCodeOutput.style.setProperty('--true-height',`calc(${executeCodeOutput.scrollHeight}px + 3.5 * var(--code-padding) + var(--header-separator-width)`);
				},SECONDARY_DELAY)
			}
		} else if (mutation.type === "childList" && (mutation.target as HTMLElement).tagName === 'PRE') { // Add execute code output
			const executeCodeOutput = (mutation.target as HTMLElement).querySelector('pre > code ~ code.language-output') as HTMLElement;
			if (executeCodeOutput) {
				executeCodeOutput.classList.add('execute-code-output');
				if (!executeCodeOutput.style.maxHeight) {
					setTimeout(()=>{
						executeCodeOutput.style.setProperty('--true-height',`calc(${executeCodeOutput.scrollHeight}px + 3.5 * var(--code-padding) + var(--header-separator-width)`);
						executeCodeOutput.style.maxHeight = 'var(--true-height)';
						executeCodeOutput.style.whiteSpace = 'var(--line-wrapping)';
					},PRIMARY_DELAY)
				}
			}
		}
	});
});
