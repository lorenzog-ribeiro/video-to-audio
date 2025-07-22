import fs from 'fs';
import 'dotenv/config';
import path from 'path';
import openAI from 'openai';

const api_key = process.env.API_KEY;
const openai = new openAI({ apiKey: api_key });

// Function to translate transcriptions
export async function generateMarkDownFile(textDir: string) {
    try {
        const texts = fs.readdirSync(textDir);
        const prompt = fs.readFileSync(path.resolve(__dirname, '../../prompts/prompt.txt'), 'utf-8');
        const markdownDir = path.resolve(__dirname, '../../working-paths/markdown');

        // Ensure output directory exists
        if (!fs.existsSync(markdownDir)) {
            fs.mkdirSync(markdownDir, { recursive: true });
        }

        for (const text of texts) {
            // Skip non-txt files
            if (!text.endsWith('.txt')) continue;

            const filePath = path.join(textDir, text);
            const content = fs.readFileSync(filePath, 'utf-8');

            // Use transcript content in the prompt
            const fullPrompt = `${prompt}\n\nTranscription:\n${content}`;

            console.log(`🔄 Processing: ${text}`);

            // Call API with complete prompt
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{
                    role: 'user',
                    content: fullPrompt
                }],
                temperature: 0.3
            });

            // Extract response and save as markdown file
            const responseContent = response.choices[0].message.content;

            if (responseContent) {
                const outputFileName = text.replace('.txt', '.md');
                const outputPath = path.join(markdownDir, outputFileName);
                fs.writeFileSync(outputPath, responseContent);
                console.log(`✅ File saved: ${outputPath}`);
            }
        }

        console.log('✅ Processing completed');
    } catch (error) {
        console.error('❌ Error processing text files:', error);
    }
}