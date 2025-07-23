import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';

const chunkMaxDuration = 600; // 10 minutes each chunk
const TEMP_DIR = path.resolve(process.cwd(), '../working-paths/temp');

// Garante que o diretório temporário existe
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export async function splitAudioIntoChunks(audioPath: string): Promise<string[]> {
    const chunks: string[] = [];
    const baseName = path.parse(audioPath).name;

    console.log(`📂 Splitting audio: ${path.basename(audioPath)}`);

    try {
        const duration = await getAudioDuration(audioPath);
        const numChunks = Math.ceil(duration / chunkMaxDuration);

        console.log(`⏱️ Duration: ${Math.round(duration)}s | Chunks: ${numChunks}`);

        for (let i = 0; i < numChunks; i++) {
            const startTime = i * chunkMaxDuration;
            // ❌ ERRO CORRIGIDO: Estava faltando ponto e vírgula
            const chunkPath = generateFileTempChunk(baseName, `chunk_${i + 1}`);

            console.log(`🔸 Creating chunk ${i + 1}/${numChunks} (${startTime}s - ${startTime + chunkMaxDuration}s)`);

            await new Promise<void>((resolve, reject) => {
                ffmpeg(audioPath)
                    .seekInput(startTime)
                    .duration(chunkMaxDuration)
                    .audioBitrate(64)
                    .audioChannels(1)
                    .audioFrequency(16000)
                    .outputFormat('mp3')
                    .on('start', (commandLine) => {
                        console.log(`   🎬 FFmpeg command: ${commandLine}`);
                    })
                    .on('progress', (progress) => {
                        if (progress.percent) {
                            process.stdout.write(`\r   ⏳ Progress chunk ${i + 1}: ${Math.round(progress.percent)}%`);
                        }
                    })
                    .on('end', () => {
                        chunks.push(chunkPath);
                        const chunkSize = fs.existsSync(chunkPath) ? getAudioSize(chunkPath) : 0;
                        console.log(`\n   ✅ Chunk ${i + 1}/${numChunks} created (${Math.round(chunkSize / 1024 / 1024)}MB)`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`\n   ❌ Error creating chunk ${i + 1}: ${err.message}`);
                        reject(err);
                    })
                    .save(chunkPath);
            });
        }

        console.log(`✅ All ${numChunks} chunks created successfully`);
        return chunks;

    } catch (error) {
        console.error(`❌ Error splitting audio ${audioPath}:`, error);
        // Limpa chunks que podem ter sido criados parcialmente
        chunks.forEach(chunk => {
            if (fs.existsSync(chunk)) {
                fs.unlinkSync(chunk);
                console.log(`🗑️ Cleaned up partial chunk: ${path.basename(chunk)}`);
            }
        });
        throw error;
    }
}

function generateFileTempChunk(baseName: string, suffix: string = ''): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    // ❌ ERRO CORRIGIDO: Adicionado underscore antes do sufixo para melhor formatação
    return path.join(TEMP_DIR, `${baseName}_${timestamp}_${random}_${suffix}.mp3`);
}

export function getAudioSize(audioPath: string): number {
    try {
        return fs.statSync(audioPath).size;
    } catch (error) {
        console.error(`❌ Error getting size of ${audioPath}:`, error);
        return 0;
    }
}

export function getAudioDuration(audioPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) {
                console.error(`❌ Error getting duration of ${audioPath}:`, err);
                reject(err);
            } else {
                const duration = metadata.format.duration || 0;
                console.log(`⏱️ Audio duration: ${Math.round(duration)}s`);
                resolve(duration);
            }
        });
    });
}

// Função para limpar arquivos temporários
export function cleanupTempFiles(files: string[]): void {
    console.log(`🧹 Cleaning up ${files.length} temporary files...`);

    files.forEach(file => {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                console.log(`   🗑️ Deleted: ${path.basename(file)}`);
            }
        } catch (error: any) {
            console.warn(`   ⚠️ Could not delete ${file}:`, error.message);
        }
    });
}