import path from 'path';
import express from 'express';
import { processAllVideos } from './processVideos';
import { transcriptMP3Audio } from './openaiServces/transcriptAudio';
import { generateMarkDownFile } from './openaiServces/gptService';

const app = express();
const port = process.env.PORT || 3030;

const audiosDir = path.resolve(__dirname, '../working-paths/audios');
const textDir = path.resolve(__dirname, '../working-paths/transcription');

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

app.post('/process-videos', async (req, res) => {
    try {
        await processAllVideos();
        res.send('🎉 Extração concluída para todos os vídeos.');
    } catch (err: any) {
        console.error('❌ Error to convert the video to audio:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
})

app.post('/transcript-audio', async (req, res) => {
    try {
        await transcriptMP3Audio(audiosDir);
        res.send('🎉 Transcrição concluida.');
    } catch (err: any) {
        console.error('❌ Error to convert the video to audio:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
})

app.post('/generate-md', async (req, res) => {
    try {
        await generateMarkDownFile(textDir);
        res.send('🎉 Translation concluded.');
    } catch (err: any) {
        console.error('❌ Error to translate the file:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
})

// app.post('/process-all-translations', async (req, res) => {
//     try {
//         await processAllTranscriptions();
//         res.send('🎉 All Files processed.');
//     } catch (err: any) {
//         console.error('❌ Error to process the files:', err);
//         res.status(500).json({ error: err.message, stack: err.stack });
//     }
// })

app.use(express.json());
