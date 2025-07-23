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
const maxFileSize = 25 * 1024 * 1024; // 25MB

// Garante que os diretórios existem
[outputDir, errorDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

function moveToTranscriptedFolder(audioPath: string, transcriptionPath: string): void {
    try {
        const fileName = path.basename(audioPath);
        const transcriptedPath = path.join(transcriptedDir, fileName);

        // Se já existe arquivo com mesmo nome, adiciona timestamp
        let finalTranscriptedPath = transcriptedPath;
        if (fs.existsSync(transcriptedPath)) {
            const ext = path.extname(fileName);
            const nameWithoutExt = path.basename(fileName, ext);
            const timestamp = Date.now();
            finalTranscriptedPath = path.join(transcriptedDir, `${nameWithoutExt}_${timestamp}${ext}`);
        }

        // Move o arquivo original
        fs.renameSync(audioPath, finalTranscriptedPath);

        // Cria um arquivo de informações sobre a transcrição
        const infoPath = path.join(transcriptedDir, `${path.basename(finalTranscriptedPath, path.extname(finalTranscriptedPath))}_info.txt`);
        const infoContent = `Original File: ${fileName}
Original Path: ${audioPath}
Transcription File: ${path.basename(transcriptionPath)}
Transcribed: ${new Date().toISOString()}
Moved to transcripted folder: ${new Date().toISOString()}
File Size: ${getAudioSize(finalTranscriptedPath)} bytes
`;

        fs.writeFileSync(infoPath, infoContent, 'utf-8');

        console.log(`✅ Moved successfully transcribed file: ${path.basename(finalTranscriptedPath)}`);
        console.log(`📋 Info file created: ${path.basename(infoPath)}`);

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

            // 🆕 VALIDAÇÃO: Verifica se arquivo está corrompido ANTES de processar
            console.log(`   🔍 Validating audio file...`);
            const isValid = await validateAudioFile(audioPath);

            if (!isValid) {
                console.log(`   ❌ File is corrupted or invalid, moving to error folder...`);
                moveToErrorFolder(audioPath, new Error('File validation failed - corrupted or invalid audio file'));
                errorCount++;
                continue; // Pula para próximo arquivo
            }

            const audioSize = getAudioSize(audioPath);
            const audioSizeMB = Math.round(audioSize / 1024 / 1024 * 100) / 100;
            console.log(`   📊 File size: ${audioSizeMB}MB`);

            let tempFiles: string[] = [];

            try {
                if (audioSize > maxFileSize) {
                    console.log(`   ⚠️ File too large (${audioSizeMB}MB), splitting into chunks...`);

                    const chunks = await splitAudioIntoChunks(audioPath);
                    tempFiles = [...chunks];
                    allTempFiles.push(...chunks);

                    console.log(`   🎯 Transcribing ${chunks.length} chunks...`);
                    const transcriptions = await Promise.all(
                        chunks.map(async (chunk: any, index: any) => {
                            return await processAudioChunk(chunk, index + 1, chunks.length);
                        })
                    );

                    const combinedTranscription = transcriptions
                        .filter((t) => t && t.trim().length > 0)
                        .join('\n\n');

                    if (combinedTranscription.trim().length > 0) {
                        const transcriptionPath = await saveTranscription(audio, combinedTranscription);
                        processedCount++; // 🆕 INCREMENTA contador de sucesso
                        console.log(`   ✅ Successfully processed: ${audio}`);

                        // 🆕 MOVE: Arquivo processado com sucesso para pasta transcripted
                        moveToTranscriptedFolder(audioPath, transcriptionPath);
                    } else {
                        console.warn(`   ⚠️ No valid transcription generated for ${audio}`);
                        // 🆕 TRATAMENTO: Move para erro se não gerou transcrição válida
                        moveToErrorFolder(audioPath, new Error('No valid transcription generated - possibly corrupted audio content'));
                        errorCount++;
                    }

                } else {
                    console.log(`   ✅ File size OK (${audioSizeMB}MB), processing directly...`);
                    const transcription = await processAudioChunk(audioPath, 1, 1);

                    if (transcription && transcription.trim().length > 0) {
                        const transcriptionPath = await saveTranscription(audio, transcription);
                        processedCount++; // 🆕 INCREMENTA contador de sucesso
                        console.log(`   ✅ Successfully processed: ${audio}`);

                        // 🆕 MOVE: Arquivo processado com sucesso para pasta transcripted
                        moveToTranscriptedFolder(audioPath, transcriptionPath);
                    } else {
                        console.warn(`   ⚠️ No valid transcription generated for ${audio}`);
                        // 🆕 TRATAMENTO: Move para erro se não gerou transcrição válida
                        moveToErrorFolder(audioPath, new Error('No valid transcription generated - possibly corrupted audio content'));
                        errorCount++;
                    }
                }

            } catch (error: any) {
                console.error(`   ❌ Error processing ${audio}:`, error.message);

                // 🆕 DETECÇÃO: Verifica se é erro de arquivo corrompido
                const corruptionIndicators = [
                    'invalid', 'corrupt', 'damaged', 'malformed',
                    'unsupported format', 'invalid file', 'decode',
                    'bad request', 'invalid_request_error'
                ];

                const isCorruptionError = corruptionIndicators.some(indicator =>
                    error.message.toLowerCase().includes(indicator)
                );

                if (isCorruptionError || error.response?.status === 400) {
                    console.log(`   🗂️ Detected corruption indicators, moving to error folder...`);
                    moveToErrorFolder(audioPath, error);
                } else {
                    console.error(`   💥 Unexpected error, keeping file in place for manual review`);
                }

                errorCount++; // 🆕 INCREMENTA contador de erro

                if (tempFiles.length > 0) {
                    cleanupTempFiles(tempFiles);
                }
            }
        }

        // 🆕 RELATÓRIO: Exibe estatísticas finais
        console.log("\n" + "=".repeat(50));
        console.log("📊 TRANSCRIPTION SUMMARY");
        console.log("=".repeat(50));
        console.log(`✅ Successfully processed: ${processedCount}/${audioFiles.length}`);
        console.log(`❌ Moved to error folder: ${errorCount}/${audioFiles.length}`);
        console.log(`📁 Transcriptions saved to: ${outputDir}`);
        console.log(`📦 Original files moved to: ${transcriptedDir}`);
        console.log(`🗂️ Error files moved to: ${errorDir}`);

        if (errorCount > 0) {
            console.log(`\n⚠️ ${errorCount} files had issues and were moved to the error folder.`);
            console.log(`   Check the error logs in ${errorDir} for details.`);
        }

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
        console.log(`     📝 Transcribing chunk ${chunkIndex}/${totalChunks}: ${path.basename(chunkPath)}`);

        if (!fs.existsSync(chunkPath)) {
            throw new Error(`Chunk file not found: ${chunkPath}`);
        }

        const chunkSize = getAudioSize(chunkPath);
        console.log(`     📊 Chunk size: ${Math.round(chunkSize / 1024 / 1024 * 100) / 100}MB`);

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(chunkPath),
            model: 'whisper-1',
            language: 'it',
            response_format: 'text'
        });

        const transcribedText = transcription as string;

        if (!transcribedText || transcribedText.trim().length === 0) {
            console.warn(`     ⚠️ Empty transcription for chunk ${chunkIndex}`);
            return '';
        }

        console.log(`     ✅ Chunk ${chunkIndex}/${totalChunks} transcribed: ${transcribedText.length} characters`);
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
        console.log(`     📝 Transcription saved: ${outputPath}`);
        return outputPath;

    } catch (error) {
        console.error(`❌ Error saving transcription for ${audioFileName}:`, error);
        throw error;
    }
}

export async function transcriptSingleAudio(audioPath: string): Promise<void> {
    if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
    }

    console.log(`🎯 Processing single file: ${path.basename(audioPath)}`);

    // 🆕 VALIDAÇÃO: Também valida arquivos únicos
    const isValid = await validateAudioFile(audioPath);
    if (!isValid) {
        console.log(`❌ File is corrupted or invalid, moving to error folder...`);
        moveToErrorFolder(audioPath, new Error('File validation failed - corrupted or invalid audio file'));
        return;
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

// 🆕 NOVA FUNÇÃO: Lista arquivos na pasta de erro
export function listErrorFiles(): void {
    try {
        if (!fs.existsSync(errorDir)) {
            console.log('📁 Error folder does not exist yet');
            return;
        }

        const errorFiles = fs.readdirSync(errorDir);
        const audioFiles = errorFiles.filter(file =>
            ['.mp3', '.wav', '.m4a', '.ogg', '.flac'].includes(path.extname(file).toLowerCase())
        );
        const logFiles = errorFiles.filter(file => file.endsWith('.log'));

        console.log('\n' + '='.repeat(40));
        console.log('📋 ERROR FOLDER CONTENTS');
        console.log('='.repeat(40));
        console.log(`📁 Location: ${errorDir}`);
        console.log(`🎵 Audio files: ${audioFiles.length}`);
        console.log(`📄 Log files: ${logFiles.length}`);

        if (audioFiles.length > 0) {
            console.log('\n🎵 Corrupted audio files:');
            audioFiles.forEach(file => {
                const filePath = path.join(errorDir, file);
                const size = fs.existsSync(filePath) ? getAudioSize(filePath) : 0;
                console.log(`   - ${file} (${Math.round(size / 1024 / 1024 * 100) / 100}MB)`);
            });
        }

        if (logFiles.length > 0) {
            console.log('\n📄 Error log files:');
            logFiles.forEach(file => {
                console.log(`   - ${file}`);
            });
        }

    } catch (error) {
        console.error('❌ Error listing error files:', error);
    }
}