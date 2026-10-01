import type { BhLang } from './types';

/** Copy overrides for the /research variant (UTEP Mike Loya Center + NSF I-Corps). */
export const RESEARCH: Record<BhLang, { about: string; foot: string; hsub: string; docTitle: string }> = {
    es: {
        about: 'Quiénes somos: un equipo de investigación del Mike Loya Center for Innovation and Commerce de UTEP, dentro del programa NSF I-Corps. Por qué preguntamos: queremos entender cómo consigue atención médica la gente de los dos lados de la frontera, y en qué parte del proceso se complica.',
        foot: 'Estudio del Mike Loya Center for Innovation and Commerce (UTEP), dentro del programa NSF I-Corps. Sus respuestas las ve solo el equipo del estudio. Nunca se venden ni se comparten con su empleador ni con aseguradoras. Preguntas: kidiaz2@miners.utep.edu',
        hsub: 'Estudio sobre acceso a la salud en la frontera',
        docTitle: 'Estudio de acceso a la salud en la frontera · UTEP MLCIC',
    },
    en: {
        about: "Who we are: a research team at UTEP's Mike Loya Center for Innovation and Commerce, part of the NSF I-Corps program. Why we ask: we want to understand how people on both sides of the border get healthcare, and where the process gets hard.",
        foot: "A study by UTEP's Mike Loya Center for Innovation and Commerce, part of the NSF I-Corps program. Only the study team sees your answers. They are never sold or shared with your employer or an insurer. Questions: kidiaz2@miners.utep.edu",
        hsub: 'Border healthcare access study',
        docTitle: 'Border healthcare access study · UTEP MLCIC',
    },
};
