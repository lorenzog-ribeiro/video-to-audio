import fs from 'fs';
import OpenAI from 'openai';
import 'dotenv/config';
import path from 'path';
import { getAudioSize, splitAudioIntoChunks, cleanupTempFiles } from '../compressAudio';

const api_key = process.env.API_KEY;
const openai = new OpenAI({ apiKey: api_key });

const outputDir = path.resolve(__dirname, '../working-paths/transcription');
const maxFileSize = 25 * 1024 * 1024; // 25MB

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

export async function transcriptMP3Audio(audioDir: string) {
    let allTempFiles: string[] = [];

    try {
        console.log(`🎵 Starting transcription process for directory: ${audioDir}`);

        if (!fs.existsSync(audioDir)) {
            throw new Error(`Audio directory not found: ${audioDir}`);
        }

        const audios = fs.readdirSync(audioDir);
        const audioFiles = audios.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp3', '.wav', '.m4a', '.ogg', '.flac'].includes(ext);
        });

        if (audioFiles.length === 0) {
            console.log('📁 No audio files found in directory');
            return;
        }

        console.log(`📊 Found ${audioFiles.length} audio files to process`);

        for (const audio of audioFiles) {
            const audioPath = path.join(audioDir, audio);
            const audioSize = getAudioSize(audioPath);
            const audioSizeMB = Math.round(audioSize / 1024 / 1024 * 100) / 100;

            console.log(`\n🎧 Processing: ${audio} (${audioSizeMB}MB)`);

            let tempFiles: string[] = [];

            try {
                if (audioSize > maxFileSize) {
                    console.log(`⚠️ File too large (${audioSizeMB}MB), splitting into chunks...`);

                    const chunks = await splitAudioIntoChunks(audioPath);
                    tempFiles = [...chunks];
                    allTempFiles.push(...chunks);

                    console.log(`🎯 Transcribing ${chunks.length} chunks...`);
                    const transcriptions = await Promise.all(
                        chunks.map(async (chunk: any, index: any) => {
                            return await processAudioChunk(chunk, index + 1, chunks.length);
                        })
                    );

                    const combinedTranscription = transcriptions
                        .filter((t) => t && t.trim().length > 0)
                        .join('\n\n');

                    if (combinedTranscription.trim().length > 0) {
                        await saveTranscription(audio, combinedTranscription);
                    } else {
                        console.warn(`⚠️ No valid transcription for ${audio}`);
                    }

                } else {
                    console.log(`✅ File size OK (${audioSizeMB}MB), processing directly...`);
                    const transcription = await processAudioChunk(audioPath, 1, 1);

                    if (transcription && transcription.trim().length > 0) {
                        await saveTranscription(audio, transcription);
                    } else {
                        console.warn(`⚠️ No valid transcription for ${audio}`);
                    }
                }

            } catch (error: any) {
                console.error(`❌ Error processing ${audio}:`, error.message);

                if (tempFiles.length > 0) {
                    cleanupTempFiles(tempFiles);
                }
            }
        }

        console.log("\n🎉 All audio files have been processed!");

    } catch (error) {
        console.error('❌ Error in transcription process:', error);
        throw error;
    } finally {
        if (allTempFiles.length > 0) {
            console.log('\n🧹 Final cleanup...');
            cleanupTempFiles(allTempFiles);
        }
    }
}

async function processAudioChunk(chunkPath: string, chunkIndex: number = 1, totalChunks: number = 1): Promise<string> {
    try {
        console.log(`   📝 Transcribing chunk ${chunkIndex}/${totalChunks}: ${path.basename(chunkPath)}`);

        if (!fs.existsSync(chunkPath)) {
            throw new Error(`Chunk file not found: ${chunkPath}`);
        }

        const chunkSize = getAudioSize(chunkPath);
        console.log(`   📊 Chunk size: ${Math.round(chunkSize / 1024 / 1024 * 100) / 100}MB`);

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(chunkPath),
            model: 'gpt-4o-mini-transcribe',
            language: 'it',
            response_format: 'text'
        });

        const transcribedText = transcription as string;

        if (!transcribedText || transcribedText.trim().length === 0) {
            console.warn(`   ⚠️ Empty transcription for chunk ${chunkIndex}`);
            return '';
        }

        console.log(`   ✅ Chunk ${chunkIndex}/${totalChunks} transcribed: ${transcribedText.length} characters`);
        return transcribedText;

    } catch (error: any) {
        console.error(`   ❌ Error transcribing chunk ${chunkIndex}:`, error.message);

        if (error.response) {
            console.error(`   📋 API Error Details:`, {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }

        return '';
    }
}

async function saveTranscription(audioFileName: string, transcription: string): Promise<void> {
    try {
        const formattedText = transcription.replace(/([.?!])\s+/g, "$1\n\n");

        const ext = path.extname(audioFileName);
        const fileNameWithoutExt = path.basename(audioFileName, ext);
        const outputPath = path.join(outputDir, `${fileNameWithoutExt}.md`);

        const markdownContent = `# Transcription: ${fileNameWithoutExt}

**Original File:** ${audioFileName}  
**Transcribed:** ${new Date().toISOString()}  
**Characters:** ${transcription.length}

---

${formattedText}
`;

        fs.writeFileSync(outputPath, markdownContent, "utf-8");
        console.log(`   📝 Transcription saved: ${outputPath}`);

    } catch (error) {
        console.error(`❌ Error saving transcription for ${audioFileName}:`, error);
        throw error;
    }
}

export async function transcriptSingleAudio(audioPath: string): Promise<void> {
    if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
    }

    const audioDir = path.dirname(audioPath);
    const audioFile = path.basename(audioPath);

    const tempDir = path.join(audioDir, 'temp-single');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempAudioPath = path.join(tempDir, audioFile);
    fs.copyFileSync(audioPath, tempAudioPath);

    try {
        await transcriptMP3Audio(tempDir);
    } finally {
        if (fs.existsSync(tempAudioPath)) {
            fs.unlinkSync(tempAudioPath);
        }
        if (fs.existsSync(tempDir)) {
            fs.rmdirSync(tempDir);
        }
    }
}