import fs from 'fs';
import 'dotenv/config';
import path from 'path';
import openAI from 'openai';
import mammoth from 'mammoth';

const api_key = process.env.API_KEY;
const openai = new openAI({ apiKey: api_key });

// Content sanitization patterns
const PROBLEMATIC_PATTERNS = [
    /\b(kill|murder|suicide|bomb|weapon|drug|illegal|hack|crack|pirate)\b/gi,
    /\b(copyright|proprietary|confidential|secret|classified)\b/gi,
    /\b(xxx|porn|adult|nsfw)\b/gi
];

// Function to sanitize content before sending to GPT
function sanitizeContent(content: string): { sanitized: string; warnings: string[] } {
    let sanitized = content;
    const warnings: string[] = [];

    // Remove or replace problematic patterns
    PROBLEMATIC_PATTERNS.forEach(pattern => {
        if (pattern.test(sanitized)) {
            warnings.push(`Found potentially problematic content matching: ${pattern.source}`);
            sanitized = sanitized.replace(pattern, '[REDACTED]');
        }
    });

    // Remove excessive special characters that might confuse the model
    sanitized = sanitized.replace(/[^\w\s\-.,!?;:'"()\[\]{}\/\\@#$%^&*+=<>|\n]/g, '');

    // Limit consecutive line breaks
    sanitized = sanitized.replace(/\n{4,}/g, '\n\n\n');

    return { sanitized, warnings };
}

// Function to estimate tokens more accurately
function estimateTokens(text: string): number {
    // More accurate approximation: 1 token ≈ 3.5 characters for English/Portuguese
    return Math.ceil(text.length / 3.5);
}

// Smart function to split text into coherent chunks
function smartSplitTextIntoChunks(text: string, maxTokens: number = 12000): string[] {
    const maxChars = maxTokens * 3.5; // More conservative approximation
    const chunks: string[] = [];

    // If text is small enough, return as single chunk
    if (text.length <= maxChars) {
        return [text];
    }

    // First, try to split by major sections (double line breaks)
    const sections = text.split(/\n\s*\n/);
    let currentChunk = '';
    let chunkCount = 0;

    for (const section of sections) {
        const potentialChunk = currentChunk + (currentChunk ? '\n\n' : '') + section;

        if (potentialChunk.length > maxChars && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = section;
            chunkCount++;
        } else {
            currentChunk = potentialChunk;
        }
    }

    // Add the last chunk if it exists
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    // If chunks are still too large, split by sentences
    const refinedChunks: string[] = [];
    for (const chunk of chunks) {
        if (chunk.length > maxChars) {
            const sentences = chunk.split(/(?<=[.!?])\s+/);
            let sentenceChunk = '';

            for (const sentence of sentences) {
                const potentialSentenceChunk = sentenceChunk + (sentenceChunk ? ' ' : '') + sentence;

                if (potentialSentenceChunk.length > maxChars && sentenceChunk.length > 0) {
                    refinedChunks.push(sentenceChunk.trim());
                    sentenceChunk = sentence;
                } else {
                    sentenceChunk = potentialSentenceChunk;
                }
            }

            if (sentenceChunk.trim()) {
                refinedChunks.push(sentenceChunk.trim());
            }
        } else {
            refinedChunks.push(chunk);
        }
    }

    return refinedChunks;
}

// Function to read file content based on extension with better error handling
async function readFileContent(filePath: string): Promise<string> {
    const extension = path.extname(filePath).toLowerCase();

    try {
        switch (extension) {
            case '.md':
                const mdContent = fs.readFileSync(filePath, 'utf-8');
                // Clean up markdown content
                return mdContent
                    .replace(/```[\s\S]*?```/g, '[CODE BLOCK]') // Replace code blocks
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove markdown links
                    .trim();

            case '.docx':
                const result = await mammoth.extractRawText({ path: filePath });
                // Clean up docx content
                return result.value
                    .replace(/\r\n/g, '\n') // Normalize line endings
                    .replace(/\t/g, '  ') // Replace tabs with spaces
                    .trim();

            default:
                throw new Error(`Unsupported file type: ${extension}`);
        }
    } catch (error: any) {
        console.error(`Error reading file ${filePath}:`, error.message);
        throw error;
    }
}

// Enhanced prompt engineering to avoid refusals
function createSafePrompt(basePrompt: string, content: string): string {
    return `You are a helpful assistant analyzing transcribed content for summarization and key insights.

IMPORTANT INSTRUCTIONS:
1. Focus on extracting factual information and creating summaries
2. If you encounter any content that seems inappropriate, simply skip it and continue with the rest
3. Do not refuse to process content - instead, focus on the parts you can summarize
4. Maintain a professional and objective tone
5. If the content seems corrupted or nonsensical, provide a brief summary stating that

BASE TASK:
${basePrompt}

CONTENT TO ANALYZE:
${content}

Please provide your analysis below:`;
}

// Function to process a single chunk with better error handling
async function processChunkWithContext(
    chunk: string,
    prompt: string,
    chunkIndex: number,
    totalChunks: number,
    fileName: string,
    retryCount: number = 0
): Promise<string> {
    const maxRetries = 3;

    // Sanitize the chunk
    const { sanitized, warnings } = sanitizeContent(chunk);

    if (warnings.length > 0) {
        console.log(`   ⚠️  Content warnings for chunk ${chunkIndex + 1}: ${warnings.length} issues found`);
    }

    // Create a safe prompt
    const safePrompt = createSafePrompt(prompt, sanitized);

    let contextualPrompt: string;

    if (totalChunks === 1) {
        contextualPrompt = safePrompt;
    } else {
        const position = chunkIndex === 0 ? 'BEGINNING' :
            chunkIndex === totalChunks - 1 ? 'FINAL' : 'MIDDLE';

        contextualPrompt = `${safePrompt}

CONTEXT: This is the ${position} section of document "${fileName}" (part ${chunkIndex + 1} of ${totalChunks}).`;
    }

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful assistant that summarizes and analyzes transcribed content. Always provide useful summaries even if the content quality is poor.'
                },
                {
                    role: 'user',
                    content: contextualPrompt
                }
            ],
            temperature: 0.3, // Lower temperature for more consistent results
            max_tokens: 8000,
            // Add safety settings
            // Note: These parameters might not be available in all OpenAI models
        });

        const result = response.choices[0].message.content || '';

        // Check for refusal patterns
        if (result.toLowerCase().includes("i can't assist") ||
            result.toLowerCase().includes("i cannot assist") ||
            result.toLowerCase().includes("i'm unable to") ||
            result.length < 50) {

            throw new Error('Received refusal or insufficient response from API');
        }

        return result;

    } catch (error: any) {
        console.error(`   ❌ Error processing chunk ${chunkIndex + 1} (attempt ${retryCount + 1}):`, error.message);

        if (retryCount < maxRetries) {
            console.log(`   🔄 Retrying with modified approach...`);

            // Try with an even simpler prompt
            const fallbackPrompt = `Please summarize the following transcribed content in a professional manner. Focus on main topics and key points:

${sanitized.substring(0, 5000)}...

Provide a summary of the main topics discussed.`;

            return processChunkWithContext(
                chunk.substring(0, 5000), // Reduce chunk size
                fallbackPrompt,
                chunkIndex,
                totalChunks,
                fileName,
                retryCount + 1
            );
        }

        // Final fallback - return a generic summary
        return `[Summary unavailable for part ${chunkIndex + 1} due to processing errors. The content may contain special characters or formatting that couldn't be processed.]`;
    }
}

// Function to validate and clean final output
function validateAndCleanOutput(content: string, fileName: string): string {
    // Check for common refusal patterns
    const refusalPatterns = [
        /i (can't|cannot|won't|will not) assist/i,
        /i'm (unable|not able) to/i,
        /i (don't|do not) have the capability/i,
        /against my guidelines/i
    ];

    for (const pattern of refusalPatterns) {
        if (pattern.test(content)) {
            console.warn(`   ⚠️  Detected refusal pattern in output for ${fileName}`);
            return `# Summary for ${fileName}

The automatic summarization encountered issues with this content. The transcription may contain:
- Special formatting or characters that couldn't be processed
- Content that triggered safety filters
- Corrupted or incomplete data

## Original Content Overview
This file appears to be a transcription that requires manual review for proper summarization.

## Recommendation
Please review the original transcription file manually for accurate content analysis.`;
        }
    }

    return content;
}

// Main function to process files and generate markdown
export async function generateMarkDownFile(textDir: string) {
    try {
        const files = fs.readdirSync(textDir);
        const promptPath = path.resolve(__dirname, '../../prompts/prompt.txt');

        // Create a safer default prompt if the prompt file doesn't exist
        let prompt = 'Please create a comprehensive summary of the following transcribed content. Focus on: 1) Main topics discussed, 2) Key points and insights, 3) Any action items or conclusions.';

        if (fs.existsSync(promptPath)) {
            prompt = fs.readFileSync(promptPath, 'utf-8');
        } else {
            console.warn('⚠️  Prompt file not found, using default prompt');
        }

        const markdownDir = path.resolve(__dirname, '../../working-paths/markdown');

        // Ensure output directory exists
        if (!fs.existsSync(markdownDir)) {
            fs.mkdirSync(markdownDir, { recursive: true });
        }

        let totalProcessed = 0;
        let totalRequests = 0;
        let successfulFiles = 0;
        let failedFiles = 0;

        console.log(`📁 Found ${files.length} files to process`);
        console.log(`🚀 Starting batch processing...\n`);

        for (const file of files) {
            // Skip files that are not .md or .docx
            const extension = path.extname(file).toLowerCase();
            if (!['.md', '.docx'].includes(extension)) {
                console.log(`⏭️  Skipping unsupported file: ${file}`);
                continue;
            }

            const filePath = path.join(textDir, file);
            totalProcessed++;

            try {
                console.log(`🔄 Processing ${totalProcessed}: ${file}`);

                const content = await readFileContent(filePath);

                // Check if content is empty or too short
                if (!content || content.trim().length < 10) {
                    console.log(`   ⚠️  File appears to be empty or corrupted`);
                    failedFiles++;
                    continue;
                }

                const estimatedTokens = estimateTokens(content + prompt);
                console.log(`   📊 Content length: ${content.length} chars (~${estimatedTokens} tokens)`);

                let finalContent = '';

                if (estimatedTokens > 15000) {
                    // Large file - use smart chunking
                    console.log(`   📝 Large file detected, using smart chunking...`);
                    const chunks = smartSplitTextIntoChunks(content);
                    console.log(`   🔄 Split into ${chunks.length} chunks`);

                    const processedChunks: string[] = [];

                    for (let i = 0; i < chunks.length; i++) {
                        console.log(`      Processing chunk ${i + 1}/${chunks.length}...`);

                        const processedChunk = await processChunkWithContext(
                            chunks[i],
                            prompt,
                            i,
                            chunks.length,
                            file
                        );

                        processedChunks.push(processedChunk);
                        totalRequests++;

                        // Rate limiting pause
                        if (i < chunks.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }

                    // Consolidate chunks
                    if (chunks.length > 1) {
                        console.log(`   🔗 Consolidating ${chunks.length} chunks...`);
                        finalContent = processedChunks.join('\n\n---\n\n');
                    } else {
                        finalContent = processedChunks[0];
                    }

                } else {
                    // Small file - process as single unit
                    console.log(`   ✅ Processing as single unit...`);

                    finalContent = await processChunkWithContext(
                        content,
                        prompt,
                        0,
                        1,
                        file
                    );
                    totalRequests++;
                }

                // Validate and clean the output
                finalContent = validateAndCleanOutput(finalContent, file);

                // Save the processed content
                if (finalContent && finalContent.length > 50) {
                    const outputFileName = file.replace(/\.(md|docx)$/, '_summary.md');
                    const outputPath = path.join(markdownDir, outputFileName);

                    // Add metadata header
                    const finalOutput = `---
source: ${file}
processed: ${new Date().toISOString()}
status: success
---

${finalContent}`;

                    fs.writeFileSync(outputPath, finalOutput);
                    console.log(`   ✅ Saved: ${outputFileName}`);
                    successfulFiles++;
                } else {
                    console.log(`   ❌ Insufficient content generated for: ${file}`);
                    failedFiles++;
                }

            } catch (fileError: any) {
                console.error(`   ❌ Error processing file ${file}:`, fileError.message);

                // Save error report
                const errorFileName = file.replace(/\.(md|docx)$/, '_error.md');
                const errorPath = path.join(markdownDir, errorFileName);
                const errorContent = `---
source: ${file}
processed: ${new Date().toISOString()}
status: error
error: ${fileError.message}
---

# Processing Error

Failed to process this file. Error details:

\`\`\`
${fileError.stack || fileError.message}
\`\`\`

Please check the original file for issues.`;

                fs.writeFileSync(errorPath, errorContent);
                failedFiles++;
                continue;
            }

            // Progress update
            console.log(`   📈 Progress: ${totalProcessed}/${files.filter(f => ['.md', '.docx'].includes(path.extname(f).toLowerCase())).length} files\n`);
        }

        // Final summary
        console.log('\n🎉 Batch processing completed!');
        console.log(`📊 Summary:`);
        console.log(`   ✅ Successful: ${successfulFiles} files`);
        console.log(`   ❌ Failed: ${failedFiles} files`);
        console.log(`   🔄 Total API requests: ${totalRequests}`);
        console.log(`   💵 Estimated cost: ~$${(totalRequests * 0.02).toFixed(2)} USD`);
        console.log(`   📁 Output directory: ${markdownDir}`);

    } catch (error) {
        console.error('❌ Fatal error during processing:', error);
    }
}