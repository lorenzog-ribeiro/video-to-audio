// No arquivo utils/compressAudio.ts, modifique a função splitAudioIntoChunks:

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

export async function splitAudioIntoChunks(
    audioPath: string,
    numberOfChunks?: number
): Promise<string[]> {
    return new Promise(async (resolve, reject) => {
        try {
            const audioDir = path.dirname(audioPath);
            const audioName = path.basename(audioPath, path.extname(audioPath));
            const audioExt = path.extname(audioPath);

            const tempDir = path.join(audioDir, 'temp_chunks');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Obtém a duração total do áudio
            const totalDuration = await getAudioDuration(audioPath);

            // Se numberOfChunks não foi especificado, calcula baseado no tamanho do arquivo
            let chunksToCreate: number;
            if (numberOfChunks) {
                chunksToCreate = numberOfChunks;
            } else {
                const fileSize = getAudioSize(audioPath);
                const maxFileSize = 25 * 1024 * 1024; // 25MB
                chunksToCreate = Math.ceil(fileSize / maxFileSize);
            }

            const chunkDuration = totalDuration / chunksToCreate;

            const chunkPromises: Promise<string>[] = [];
            const chunkPaths: string[] = [];

            for (let i = 0; i < chunksToCreate; i++) {
                const startTime = i * chunkDuration;
                const chunkPath = path.join(tempDir, `${audioName}_chunk_${i + 1}${audioExt}`);
                chunkPaths.push(chunkPath);

                const chunkPromise = new Promise<string>((resolveChunk, rejectChunk) => {
                    let command = ffmpeg(audioPath)
                        .seekInput(startTime)
                        .duration(chunkDuration)
                        .output(chunkPath)
                        .audioCodec('copy') // Mantém o codec original para ser mais rápido
                        .on('end', () => {
                            resolveChunk(chunkPath);
                        })
                        .on('error', (err) => {
                            console.error(`     ❌ Error creating chunk ${i + 1}:`, err.message);
                            rejectChunk(err);
                        });

                    if (i === chunksToCreate - 1) {
                        command = ffmpeg(audioPath)
                            .seekInput(startTime)
                            .output(chunkPath)
                            .audioCodec('copy')
                            .on('end', () => {
                                console.log(`     ✅ Final chunk ${i + 1}/${chunksToCreate} created`);
                                resolveChunk(chunkPath);
                            })
                            .on('error', (err) => {
                                console.error(`     ❌ Error creating final chunk ${i + 1}:`, err.message);
                                rejectChunk(err);
                            });
                    }

                    command.run();
                });

                chunkPromises.push(chunkPromise);
            }

            await Promise.all(chunkPromises);

            const validChunks = chunkPaths.filter(chunkPath => {
                if (!fs.existsSync(chunkPath)) {
                    console.warn(`     ⚠️ Chunk not found: ${path.basename(chunkPath)}`);
                    return false;
                }

                const chunkSize = getAudioSize(chunkPath);
                if (chunkSize === 0) {
                    console.warn(`     ⚠️ Empty chunk: ${path.basename(chunkPath)}`);
                    return false;
                }

                return true;
            });

            if (validChunks.length === 0) {
                throw new Error('No valid chunks were created');
            }
            resolve(validChunks);
        } catch (error) {
            console.error('❌ Error splitting audio into chunks:', error);
            reject(error);
        }
    });
}

// Função auxiliar para obter duração do áudio
export async function getAudioDuration(audioPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) {
                reject(err);
                return;
            }

            const duration = metadata.format.duration;
            if (typeof duration === 'number') {
                resolve(duration);
            } else {
                reject(new Error('Could not determine audio duration'));
            }
        });
    });
}

// Função auxiliar para obter tamanho do arquivo
export function getAudioSize(audioPath: string): number {
    try {
        const stats = fs.statSync(audioPath);
        return stats.size;
    } catch (error) {
        console.error('Error getting file size:', error);
        return 0;
    }
}

// Função para limpar arquivos temporários
export function cleanupTempFiles(tempFiles: string[]): void {
    tempFiles.forEach(tempFile => {
        try {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
                console.log(`   🗑️ Cleaned up: ${path.basename(tempFile)}`);
            }
        } catch (error) {
            console.warn(`   ⚠️ Could not delete temp file: ${path.basename(tempFile)}`);
        }
    });

    // Remove diretório temporário se estiver vazio
    tempFiles.forEach(tempFile => {
        const tempDir = path.dirname(tempFile);
        try {
            if (fs.existsSync(tempDir) && fs.readdirSync(tempDir).length === 0) {
                fs.rmdirSync(tempDir);
                console.log(`   🗑️ Removed temp directory: ${path.basename(tempDir)}`);
            }
        } catch (error) {
            // Ignora erro ao remover diretório
        }
    });
}