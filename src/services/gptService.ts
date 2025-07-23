import fs from 'fs';
import 'dotenv/config';
import path from 'path';
import openAI from 'openai';
import mammoth from 'mammoth';

const api_key = process.env.API_KEY;
const openai = new openAI({ apiKey: api_key });

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

// Function to read file content based on extension
async function readFileContent(filePath: string): Promise<string> {
    const extension = path.extname(filePath).toLowerCase();

    switch (extension) {
        case '.md':
            return fs.readFileSync(filePath, 'utf-8');

        case '.docx':
            const result = await mammoth.extractRawText({ path: filePath });
            return result.value;

        default:
            throw new Error(`Unsupported file type: ${extension}`);
    }
}

// Function to process a single chunk with contextual awareness
async function processChunkWithContext(
    chunk: string,
    prompt: string,
    chunkIndex: number,
    totalChunks: number,
    fileName: string
): Promise<string> {
    let contextualPrompt: string;

    if (totalChunks === 1) {
        // Single chunk - process normally
        contextualPrompt = `${prompt}\n\nDocument Content:\n${chunk}`;
    } else {
        // Multiple chunks - provide context for better coherence
        if (chunkIndex === 0) {
            contextualPrompt = `${prompt}

IMPORTANT CONTEXT: This is the BEGINNING of document "${fileName}" (part ${chunkIndex + 1} of ${totalChunks}).
Process this initial section while maintaining context for subsequent parts.
Do not provide final conclusions yet.

Document Content (Part ${chunkIndex + 1}/${totalChunks}):\n${chunk}`;
        } else if (chunkIndex === totalChunks - 1) {
            contextualPrompt = `${prompt}

IMPORTANT CONTEXT: This is the FINAL part of document "${fileName}" (part ${chunkIndex + 1} of ${totalChunks}).
Complete the processing considering this is the document's conclusion.
Provide final insights and wrap up the analysis.

Document Content (Part ${chunkIndex + 1}/${totalChunks}):\n${chunk}`;
        } else {
            contextualPrompt = `${prompt}

IMPORTANT CONTEXT: This is a MIDDLE section of document "${fileName}" (part ${chunkIndex + 1} of ${totalChunks}).
Continue processing this section maintaining consistency with previous parts.
Do not provide final conclusions yet.

Document Content (Part ${chunkIndex + 1}/${totalChunks}):\n${chunk}`;
        }
    }

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{
                role: 'user',
                content: contextualPrompt
            }],
            temperature: 0.2,
            max_tokens: 10000 // Limit output to control costs
        });

        return response.choices[0].message.content || '';
    } catch (error) {
        console.error(`Error processing chunk ${chunkIndex + 1}:`, error);
        try {
            const fallbackResponse = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [{
                    role: 'user',
                    content: contextualPrompt
                }],
                temperature: 0.2,
                max_tokens: 10000
            });
            return fallbackResponse.choices[0].message.content || '';
        } catch (fallbackError) {
            console.error(`Fallback also failed for chunk ${chunkIndex + 1}:`, fallbackError);
            return `[Error processing part ${chunkIndex + 1} of document]`;
        }
    }
}

// Function to consolidate multiple chunks into a coherent final output
async function consolidateChunks(
    processedChunks: string[],
    fileName: string,
    originalPrompt: string
): Promise<string> {
    if (processedChunks.length === 1) {
        return processedChunks[0];
    }

    const consolidationPrompt = `You have received a document "${fileName}" that was processed in ${processedChunks.length} separate parts due to length constraints.

Your task is to consolidate these parts into a single, coherent, and well-structured output that:
1. Eliminates any duplications or redundancies
2. Ensures smooth transitions between sections
3. Maintains consistency in tone and style
4. Provides a comprehensive and unified result
5. Follows the original processing instructions

PROCESSED PARTS:
${processedChunks.map((chunk, index) => `\n=== PART ${index + 1} ===\n${chunk}`).join('\n')}

Please consolidate all parts into a single, cohesive document that reads as if it was processed as one unit.`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o', // Use cheaper model for consolidation
            messages: [{
                role: 'user',
                content: consolidationPrompt
            }],
            temperature: 0.1, // Very low temperature for consistency
            max_tokens: 10000
        });

        return response.choices[0].message.content || processedChunks.join('\n\n---\n\n');
    } catch (error) {
        console.error('Error during consolidation:', error);
        // Return chunks joined with separators if consolidation fails
        return processedChunks.join('\n\n--- SECTION BREAK ---\n\n');
    }
}

// Main function to process files and generate markdown
export async function generateMarkDownFile(textDir: string) {
    try {
        const files = fs.readdirSync(textDir);
        const prompt = fs.readFileSync(path.resolve(__dirname, '../../prompts/prompt.txt'), 'utf-8');
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
                const estimatedTokens = estimateTokens(content + prompt);
                console.log(`   📊 Estimated tokens: ${estimatedTokens}`);

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
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }

                    // Consolidate chunks for coherent output
                    console.log(`   🔗 Consolidating ${chunks.length} chunks...`);
                    finalContent = await consolidateChunks(processedChunks, file, prompt);
                    totalRequests++; // Add consolidation request to count

                } else {
                    // Small file - process as single unit
                    console.log(`   ✅ Processing as single unit...`);
                    const fullPrompt = `${prompt}\n\nDocument Content:\n${content}`;

                    try {
                        const response = await openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: [{
                                role: 'user',
                                content: fullPrompt
                            }],
                            temperature: 0.2
                        });

                        finalContent = response.choices[0].message.content || '';
                        totalRequests++;
                    } catch (error) {
                        const fallbackResponse = await openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: [{
                                role: 'user',
                                content: fullPrompt
                            }],
                            temperature: 0.2
                        });

                        finalContent = fallbackResponse.choices[0].message.content || '';
                        totalRequests++;
                    }
                }

                // Save the processed content
                if (finalContent) {
                    const outputFileName = file.replace(/\.(md|docx)$/, '.md');
                    const outputPath = path.join(markdownDir, outputFileName);
                    fs.writeFileSync(outputPath, finalContent);
                    console.log(`   ✅ Saved: ${outputFileName}`);
                    successfulFiles++;
                } else {
                    console.log(`   ❌ No content generated for: ${file}`);
                    failedFiles++;
                }

            } catch (fileError) {
                console.error(`   ❌ Error processing file ${file}:`, fileError);
                failedFiles++;
                continue;
            }

            // Progress update
            console.log(`   💰 Requests so far: ${totalRequests}`);
            console.log(`   📈 Progress: ${totalProcessed}/${files.filter(f => ['.md', '.docx'].includes(path.extname(f).toLowerCase())).length} files\n`);
        }

        // Final summary
        console.log('\n🎉 Batch processing completed!');
        console.log(`📊 Summary:`);
        console.log(`   ✅ Successful: ${successfulFiles} files`);
        console.log(`   ❌ Failed: ${failedFiles} files`);
        console.log(`   🔄 Total API requests: ${totalRequests}`);
        console.log(`   💵 Estimated cost: ~$${(totalRequests * 0.01).toFixed(2)} USD`);

    } catch (error) {
        console.error('❌ Fatal error during processing:', error);
    }
}