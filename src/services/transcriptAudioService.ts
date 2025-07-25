import fs from 'fs';
import OpenAI from 'openai';
import 'dotenv/config';
import path from 'path';
import { getAudioSize, splitAudioIntoChunks, cleanupTempFiles, getAudioDuration } from '../utils/compressAudio';

const api_key = process.env.API_KEY;
const openai = new OpenAI({ apiKey: api_key });

const transcriptedDir = path.resolve(__dirname, '../../working-paths/transcripted');
const outputDir = path.resolve(__dirname, '../../working-paths/transcription');
const errorDir = path.resolve(__dirname, '../../working-paths/error');

const maxFileSize = 25 * 1024 * 1024;
const maxDurationSeconds = 1400;

[outputDir, errorDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

function moveToTranscriptedFolder(audioPath: string, transcriptionPath: string): void {
    try {
        const fileName = path.basename(audioPath);
        const transcriptedPath = path.join(transcriptedDir, fileName);

        let finalTranscriptedPath = transcriptedPath;
        if (fs.existsSync(transcriptedPath)) {
            const ext = path.extname(fileName);
            const nameWithoutExt = path.basename(fileName, ext);
            const timestamp = Date.now();
            finalTranscriptedPath = path.join(transcriptedDir, `${nameWithoutExt}_${timestamp}${ext}`);
        }

        fs.renameSync(audioPath, finalTranscriptedPath);

        const infoPath = path.join(transcriptedDir, `${path.basename(finalTranscriptedPath, path.extname(finalTranscriptedPath))}_info.txt`);
        const infoContent = `Original File: ${fileName}
Original Path: ${audioPath}
Transcription File: ${path.basename(transcriptionPath)}
Transcribed: ${new Date().toISOString()}
Moved to transcripted folder: ${new Date().toISOString()}
File Size: ${getAudioSize(finalTranscriptedPath)} bytes
`;

        fs.writeFileSync(infoPath, infoContent, 'utf-8');

    } catch (moveError: any) {
        console.error(`❌ Error moving file to transcripted folder: ${moveError.message}`);
        console.error(`   Original audio path: ${audioPath}`);
        console.warn(`   ⚠️ Keeping original file in place, but transcription was successful`);
    }
}

function moveToErrorFolder(audioPath: string, error: any): void {
    try {
        const fileName = path.basename(audioPath);
        const errorPath = path.join(errorDir, fileName);

        let finalErrorPath = errorPath;
        if (fs.existsSync(errorPath)) {
            const ext = path.extname(fileName);
            const nameWithoutExt = path.basename(fileName, ext);
            const timestamp = Date.now();
            finalErrorPath = path.join(errorDir, `${nameWithoutExt}_${timestamp}${ext}`);
        }

        fs.renameSync(audioPath, finalErrorPath);

        const logPath = path.join(errorDir, `${path.basename(finalErrorPath, path.extname(finalErrorPath))}_error.log`);
        const errorLog = `File: ${fileName}
Original Path: ${audioPath}
Error Time: ${new Date().toISOString()}
Error Type: ${error.name || 'Unknown'}
Error Message: ${error.message || 'No message available'}
Stack Trace: ${error.stack || 'No stack trace available'}

Additional Info:
- File Size: ${fs.existsSync(finalErrorPath) ? getAudioSize(finalErrorPath) : 'Unknown'} bytes
- API Response: ${error.response ? JSON.stringify(error.response.data, null, 2) : 'No API response'}
`;

        fs.writeFileSync(logPath, errorLog, 'utf-8');

        console.log(`🗂️ Moved corrupted file to error folder: ${path.basename(finalErrorPath)}`);
        console.log(`📋 Error log created: ${path.basename(logPath)}`);

    } catch (moveError: any) {
        console.error(`❌ Error moving file to error folder: ${moveError.message}`);
        console.error(`   Original path: ${audioPath}`);
    }
}

async function validateAudioFile(audioPath: string): Promise<boolean> {
    try {
        if (!fs.existsSync(audioPath)) {
            throw new Error('File does not exist');
        }

        const size = getAudioSize(audioPath);
        if (size === 0) {
            throw new Error('File is empty (0 bytes)');
        }

        const duration = await getAudioDuration(audioPath);
        if (duration === 0 || isNaN(duration)) {
            throw new Error('Invalid audio duration or corrupted file structure');
        }

        console.log(`   ✅ File validation passed: ${Math.round(size / 1024 / 1024 * 100) / 100}MB, ${Math.round(duration)}s`);
        return true;

    } catch (error: any) {
        console.log(`   ❌ File validation failed: ${error.message}`);
        return false;
    }
}

async function processAudioChunk(chunkPath: string, chunkIndex: number = 1, totalChunks: number = 1): Promise<string> {
    try {
        if (!fs.existsSync(chunkPath)) {
            throw new Error(`Chunk file not found: ${chunkPath}`);
        }

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(chunkPath),
            model: 'gpt-4o-transcribe',
            language: 'it',
            response_format: 'text'
        });

        const transcribedText = transcription as string;

        if (!transcribedText || transcribedText.trim().length === 0) {
            console.warn(`     ⚠️ Empty transcription for chunk ${chunkIndex}`);
            return '';
        }
        return transcribedText;
    } catch (error: any) {
        console.error(`     ❌ Error transcribing chunk ${chunkIndex}:`, error.message);

        if (error.response) {
            console.error(`     📋 API Error Details:`, {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }

        const corruptionIndicators = [
            'invalid', 'corrupt', 'malformed', 'unsupported',
            'decode', 'bad request', 'invalid_request_error'
        ];

        const isCorruptionError = corruptionIndicators.some(indicator =>
            error.message.toLowerCase().includes(indicator)
        ) || error.response?.status === 400;

        if (isCorruptionError) {
            throw new Error(`Corrupted audio chunk detected: ${error.message}`);
        }
        return '';
    }
}

async function saveTranscription(audioFileName: string, transcription: string): Promise<string> {
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
        return outputPath;

    } catch (error) {
        throw `❌ Error saving transcription for ${audioFileName}, ${error}:`;
    }
}

export async function transcriptMP3Audio(audioDir: string) {
    let allTempFiles: string[] = [];
    let processedCount = 0;
    let errorCount = 0;

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

            console.log(`\n🎧 Processing: ${audio}`);

            // Validação: Verifica se arquivo está corrompido ANTES de processar
            console.log(`   🔍 Validating audio file...`);
            const isValid = await validateAudioFile(audioPath);

            if (!isValid) {
                console.log(`   ❌ File is corrupted or invalid, moving to error folder...`);
                moveToErrorFolder(audioPath, new Error('File validation failed - corrupted or invalid audio file'));
                errorCount++;
                continue;
            }

            const audioSize = getAudioSize(audioPath);
            const audioSizeMB = Math.round(audioSize / 1024 / 1024 * 100) / 100;
            const audioDuration = await getAudioDuration(audioPath);

            console.log(`   📊 File size: ${audioSizeMB}MB`);
            console.log(`   ⏱️ Audio duration: ${Math.round(audioDuration)}s (${Math.round(audioDuration / 60)}min)`);

            let tempFiles: string[] = [];

            try {
                const needsSplitting = audioSize > maxFileSize || audioDuration > maxDurationSeconds;

                if (needsSplitting) {

                    const chunksNeededByDuration = Math.ceil(audioDuration / maxDurationSeconds);
                    const chunksNeededBySize = Math.ceil(audioSize / maxFileSize);
                    const chunksNeeded = Math.max(chunksNeededByDuration, chunksNeededBySize);

                    const chunks = await splitAudioIntoChunks(audioPath, chunksNeeded);
                    tempFiles = [...chunks];
                    allTempFiles.push(...chunks);

                    const validChunks = [];
                    for (let i = 0; i < chunks.length; i++) {
                        const chunkDuration = await getAudioDuration(chunks[i]);

                        if (chunkDuration > maxDurationSeconds) {
                            continue;
                        }
                        validChunks.push({ path: chunks[i], index: i + 1 });
                    }

                    if (validChunks.length === 0) {
                        throw new Error('No valid chunks could be created within duration limits');
                    }

                    const transcriptions = await Promise.all(
                        validChunks.map(async (chunk) => {
                            return await processAudioChunk(chunk.path, chunk.index, validChunks.length);
                        })
                    );

                    const combinedTranscription = transcriptions
                        .filter((t) => t && t.trim().length > 0)
                        .join('\n\n');

                    if (combinedTranscription.trim().length > 0) {
                        const transcriptionPath = await saveTranscription(audio, combinedTranscription);
                        processedCount++;
                        moveToTranscriptedFolder(audioPath, transcriptionPath);
                    } else {
                        moveToErrorFolder(audioPath, new Error('No valid transcription generated - all chunks failed or were too long'));
                        errorCount++;
                    }

                } else {
                    const transcription = await processAudioChunk(audioPath, 1, 1);

                    if (transcription && transcription.trim().length > 0) {
                        const transcriptionPath = await saveTranscription(audio, transcription);
                        processedCount++;
                        moveToTranscriptedFolder(audioPath, transcriptionPath);
                    } else {
                        moveToErrorFolder(audioPath, new Error('No valid transcription generated - possibly corrupted audio content'));
                        errorCount++;
                    }
                }

            } catch (error: any) {
                const durationError = error.message.includes('longer than') && error.message.includes('maximum');

                const corruptionIndicators = [
                    'invalid', 'corrupt', 'damaged', 'malformed',
                    'unsupported format', 'invalid file', 'decode',
                    'bad request', 'invalid_request_error'
                ];

                const isCorruptionError = corruptionIndicators.some(indicator =>
                    error.message.toLowerCase().includes(indicator)
                ) || durationError;

                if (isCorruptionError || error.response?.status === 400) {
                    moveToErrorFolder(audioPath, error);
                }

                errorCount++;

                if (tempFiles.length > 0) {
                    cleanupTempFiles(tempFiles);
                }
            }
        }

    } catch (error) {
        throw error;
    } finally {
        if (allTempFiles.length > 0) {
            cleanupTempFiles(allTempFiles);
        }
    }
}