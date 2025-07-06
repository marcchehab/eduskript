import type { Root, Node, Text, Paragraph, Parent } from 'mdast'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'
import { fromMarkdown } from 'mdast-util-from-markdown'

/**
 * Remark plugin to transform wiki links to markdown links in EduGarden
 * Handles wiki links that span across multiple nodes and node types
 * 
 * Transforms:
 * - [[Page Title]] -> [Page Title](../page-slug)
 * - [[Chapter/Page]] -> [Page](../chapter-slug/page-slug)
 * - [[Script/Chapter/Page]] -> [Page](../../script-slug/chapter-slug/page-slug)
 * - [[Page|Custom Text]] -> [Custom Text](../page-slug)
 * - [[/uploads/image.png]] -> [](uploads/image.png) (absolute paths preserved)
 * - ![[/uploads/image.png]] -> ![](/uploads/image.png) (image embeds with absolute paths)
 */
export const remarkWikiLinks: Plugin<[], Root> = () => (ast) => {
    // Handle complete wiki links in a single node
    visit(ast, 'text', (node: Text, index: number | undefined, parent: Parent | undefined) => {
        if (node.value.includes('[[') && node.value.includes(']]') && parent && index !== undefined) {
            transformNodeWithWikiLinks(node, index, parent);
        }
    });

    // Handle split wiki links across multiple nodes of potentially different types
    visit(ast, 'paragraph', (paragraph: Paragraph) => {
        // Search for patterns like: [text with '![[' or '[['] + [any nodes] + [text with ']]']
        if (!paragraph.children || paragraph.children.length < 2) return;

        for (let i = 0; i < paragraph.children.length; i++) {
            const startNode = paragraph.children[i];

            // Check if this node contains the start of a wiki link
            if (startNode && startNode.type === 'text' &&
                (startNode.value.includes('![[') || startNode.value.endsWith('[[') ||
                    startNode.value.includes('[[') && !startNode.value.includes(']]'))) {

                // Look for a matching end node
                for (let j = i; j < paragraph.children.length; j++) {
                    const endNode = paragraph.children[j];

                    if (endNode && endNode.type === 'text' && endNode.value.includes(']]')) {
                        if (i === j && startNode.value.includes('[[') && startNode.value.includes(']]')) {
                            // This is a complete wiki link in a single node - already handled by first visit
                            continue;
                        }

                        // Extract content between [[ and ]]
                        let fullContent = "";
                        let openingFound = false;
                        let extractedMiddle = "";

                        // Process start node
                        if (startNode.value.includes('![[')) {
                            const parts = startNode.value.split('![[');
                            fullContent += parts[0]; // Content before ![[
                            openingFound = true;

                            // Check if the opening node has more text after ![[ that needs to be part of the link
                            if (parts.length > 1 && parts[1]) {
                                extractedMiddle = parts[1];
                            }
                        } else if (startNode.value.includes('[[')) {
                            const parts = startNode.value.split('[[');
                            fullContent += parts[0]; // Content before [[
                            openingFound = true;

                            // Check if the opening node has more text after [[ that needs to be part of the link
                            if (parts.length > 1 && parts[1]) {
                                extractedMiddle = parts[1];
                            }
                        }

                        // Extract content from middle nodes
                        for (let k = i + 1; k < j; k++) {
                            const middleNode = paragraph.children[k];
                            if (!middleNode) continue;

                            if (middleNode.type === 'text') {
                                extractedMiddle += middleNode.value;
                            } else if (middleNode.type === 'link') {
                                // For link nodes, use the URL
                                extractedMiddle += middleNode.url;
                            } else {
                                // For other node types, try to get a string representation
                                try {
                                    extractedMiddle += JSON.stringify(middleNode);
                                } catch (e) {
                                    extractedMiddle += "[complex content]";
                                }
                            }
                        }

                        // Process end node
                        let closingParts = endNode.value.split(']]');
                        extractedMiddle += closingParts[0]; // Content before ]]

                        // Create the complete wiki link syntax
                        let wikiLinkSyntax = '';
                        if (startNode.value.includes('![[')) {
                            wikiLinkSyntax = `![[${extractedMiddle}]]`;
                        } else {
                            wikiLinkSyntax = `[[${extractedMiddle}]]`;
                        }

                        // Transform the wiki link
                        const transformedLink = processWikiLinks(wikiLinkSyntax);
                        fullContent += transformedLink;

                        // Add any content after the closing ]]
                        if (closingParts.length > 1) {
                            fullContent += closingParts.slice(1).join(']]');
                        }

                        // Parse the transformed content back to nodes
                        const parsedAst = fromMarkdown(fullContent);

                        if (parsedAst.children.length > 0 && parsedAst.children[0]?.type === 'paragraph') {
                            // Replace the range of nodes with the transformed content
                            const nodesToRemove = j - i + 1;
                            paragraph.children.splice(i, nodesToRemove, ...parsedAst.children[0].children);

                            // Adjust the loop index since we've modified the children array
                            j = i - 1; // Will be incremented to i in the next iteration
                        }

                        break; // Move to the next potential wiki link
                    }
                }
            }
        }
    });

    return ast;

    // Helper function to transform a node with wiki links
    function transformNodeWithWikiLinks(node: Text, index: number, parent: Parent) {
        const transformedText = processWikiLinks(node.value);

        if (transformedText !== node.value) {
            const parsedAst = fromMarkdown(transformedText);
            if (parsedAst.children.length > 0 && parsedAst.children[0]?.type === 'paragraph') {
                const paragraphNode = parsedAst.children[0] as Paragraph;
                parent.children.splice(index, 1, ...paragraphNode.children);
            }
        }
    }

    // Helper function to process wiki links text
    function processWikiLinks(text: string): string {
        return text.replace(
            /!?\[\[(.+?)(?:\|(.+?))?\]\]/g,
            (match, link, displayText) => {
                // Handle image embeds (!)
                const isEmbed = match.startsWith('![[');
                
                // Clean up the link path
                link = link.trim();
                
                // Check if this is an absolute path (starts with /) or a URL (contains ://)
                if (link.startsWith('/') || link.includes('://')) {
                    // For absolute paths and URLs, use them as-is
                    const linkText = displayText || (isEmbed ? '' : link.split('/').pop() || link);
                    
                    if (isEmbed) {
                        return `![${linkText}](${link})`;
                    }
                    return `[${linkText}](${link})`;
                }
                
                // Check if this is just a filename (contains file extension and no path separators)
                const isFilename = !link.includes('/') && /\.[a-zA-Z0-9]+$/.test(link);
                
                if (isEmbed && isFilename) {
                    // For image embeds with just filenames, pass through unchanged
                    // Let the path correction plugin handle the path resolution
                    const linkText = displayText || '';
                    return `![${linkText}](${link})`;
                }
                
                // Generate URL-friendly slug (only for relative wiki links)
                const generateSlug = (str: string) => {
                    // Remove file extension for page slugs, but preserve it for file paths
                    const withoutExt = str.replace(/\.[^/.]+$/, '');
                    return withoutExt
                        .toLowerCase()
                        .replace(/[^\w\s-]/g, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-')
                        .trim();
                };

                // Parse the link structure for wiki-style links
                const parts = link.split('/').filter((part: string) => part.trim());
                let url = '';
                let linkText = displayText || '';

                if (parts.length === 1) {
                    // [[Page Title]] - link to page in current chapter
                    const pageSlug = generateSlug(parts[0]);
                    url = `../${pageSlug}`;
                    linkText = linkText || parts[0];
                } else if (parts.length === 2) {
                    // [[Chapter/Page]] - link to page in specific chapter
                    const chapterSlug = generateSlug(parts[0]);
                    const pageSlug = generateSlug(parts[1]);
                    url = `../${chapterSlug}/${pageSlug}`;
                    linkText = linkText || parts[1];
                } else if (parts.length === 3) {
                    // [[Script/Chapter/Page]] - link to page in different script
                    const scriptSlug = generateSlug(parts[0]);
                    const chapterSlug = generateSlug(parts[1]);
                    const pageSlug = generateSlug(parts[2]);
                    url = `../../${scriptSlug}/${chapterSlug}/${pageSlug}`;
                    linkText = linkText || parts[2];
                } else {
                    // Fallback for complex paths
                    url = parts.map(generateSlug).join('/');
                    linkText = linkText || parts[parts.length - 1];
                }

                // For image embeds, create an image tag
                if (isEmbed) {
                    return `![${linkText}](${url})`;
                }

                // Regular link
                return `[${linkText}](${url})`;
            }
        );
    }
};
