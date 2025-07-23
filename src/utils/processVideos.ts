import fs from 'fs';
import path from 'path';
import ffm from 'fluent-ffmpeg';


ffm.setFfmpegPath('C:/ffmpeg/bin/ffmpeg.exe');

const videosDir = path.resolve(__dirname, '../working-paths/videos');
const audiosDir = path.resolve(__dirname, '../working-paths/audios');


function extractAudioFromVideo(videoFilePath: string, outputFilePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.stat(videoFilePath, (err, stats) => {
            if (err) {
                return reject(err);
            }


            ffm.ffprobe(videoFilePath, (err, metadata) => {
                if (err) {
                    return reject(err);
                }
                const durationSec = metadata.format.duration?.toFixed(2) || '0';
                const fileSizeMB = (Number.parseInt(metadata.format.size?.toFixed(2)!)/ (1024 * 1024));

                ffm(videoFilePath)
                    .outputFormat('mp3')
                    .outputOptions(['-metadata', `comment=Duration: ${durationSec}s, Size: ${fileSizeMB}MB`])
                    .on('end', () => {
                        console.log(`✅ Áudio extraído de: ${path.basename(videoFilePath)}`);
                        console.log(`   ➤ Duração do vídeo: ${durationSec}s`);
                        console.log(`   ➤ Tamanho do vídeo: ${fileSizeMB}MB`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`❌ Erro no arquivo ${path.basename(videoFilePath)}: ${err.message}`);
                        reject(err);
                    })
                    .save(outputFilePath);
            });
        });

    });
}

export async function processAllVideos() {
    try {
        const files = fs.readdirSync(videosDir);

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (!['.mp4', '.mov', '.mkv', '.avi'].includes(ext)) continue;

            const videoPath = path.join(videosDir, file);
            const audioPath = path.join(audiosDir, `${path.parse(file).name}.mp3`);

            try {
                await extractAudioFromVideo(videoPath, audioPath);
            } catch (err) {
                console.error(`Erro ao processar ${file}`);
            }
        }

        console.log('🎉 Extração concluída para todos os vídeos.');
    } catch (err) {
        console.error('Erro ao processar vídeos:', err);
    }
}
