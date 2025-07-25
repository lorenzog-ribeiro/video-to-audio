import path from 'path';
import express from 'express';
import { transcriptMP3Audio } from '../services/transcriptAudioService';
import { generateMarkDownFile } from '../services/gptService';
import { insertAllMarkdownToWiki } from '../services/wikijsMarkdowndService';
import { processAllVideos } from '../utils/processVideos';

const app = express();
const audiosDir = path.resolve(__dirname, '../working-paths/audios');
const textDir = path.resolve(__dirname, '../working-paths/transcription');

/**
 * @swagger
 * /process-videos:
 *   post:
 *     summary: Extrai o áudio de todos os vídeos da pasta.
 *     tags: [Transcrição]
 *     responses:
 *       200:
 *         description: Extração concluída com sucesso.
 *       500:
 *         description: Erro durante a extração.
 */
app.post('/process-videos', async (req, res) => {
    try {
        await processAllVideos();
        res.send('🎉 Extração concluída para todos os vídeos.');
    } catch (err: any) {
        console.error('❌ Error to convert the video to audio:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
})

/**
 * @swagger
 * /transcript-audio:
 *   post:
 *     summary: Transcreve todos os audios utilizando o modelo gpt-4o.
 *     tags: [Transcrição]
 *     responses:
 *       200:
 *         description: Extração concluída com sucesso.
 *       500:
 *         description: Erro durante a extração.
 */
app.post('/transcript-audio', async (req, res) => {
    try {
        await transcriptMP3Audio(audiosDir);
        res.send('🎉 Transcrição concluida.');
    } catch (err: any) {
        console.error('❌ Error to convert the video to audio:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
})

/**
 * @swagger
 * /generate-md:
 *   post:
 *     summary: Gera um arquivo markdown estruturado de todos os arquivos que existem na pasta transcription.
 *     tags: [Transcrição]
 *     responses:
 *       200:
 *         description: Extração concluída com sucesso.
 *       500:
 *         description: Erro durante a extração.
 */
app.post('/generate-md', async (req, res) => {
    try {
        await generateMarkDownFile(textDir);
        res.send('🎉 Translation concluded.');
    } catch (err: any) {
        console.error('❌ Error to translate the file:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
})

/**
 * @swagger
 * /insert-wikijs:
 *   post:
 *     summary: Insere todos os arquivos markdown no wiki JS como parte da documentação.
 *     tags: [Transcrição]
 *     responses:
 *       200:
 *         description: Extração concluída com sucesso.
 *       500:
 *         description: Erro durante a extração.
 */
app.post('/insert-wikijs', async (req, res) => {
    try {
        await insertAllMarkdownToWiki();
        res.send('🎉 All Markdown are inserted on wikijs.');
    } catch (err: any) {
        console.error('❌ Error to insert the file on wiki js:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
})