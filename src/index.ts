import fs from 'fs';
import path from 'path';
import express from 'express';
import ffm from 'fluent-ffmpeg';

const app = express();
const port = process.env.PORT || 3030;
ffm.setFfmpegPath('C:/ffmpeg/bin/ffmpeg.exe');
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

app.use(express.json());


const videosDir = path.resolve(__dirname, '../working-paths/videos');
const audiosDir = path.resolve(__dirname, '../working-paths/audios');


function extractAudioFromVideo(videoFilePath: string, outputFilePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.stat(videoFilePath, (err, stats) => {
            if (err) {
                return reject(err);
            }
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);


            ffm.ffprobe(videoFilePath, (err, metadata) => {
                if (err) {
                    return reject(err);
                }
                const durationSec = metadata.format.duration?.toFixed(2) || '0';

                ffm(videoFilePath)
                    .outputFormat('mp3')
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

async function processAllVideos() {
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


processAllVideos();