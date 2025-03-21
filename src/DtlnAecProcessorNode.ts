import { loadTFLiteModel } from '@tensorflow/tfjs-tflite'
import { blockShift } from './constants'
import { createAecProcess } from './aecProcess'
import { AecModel1, AecModel2 } from './model'

/*!
 * Model files license
 * Copyright (c) 2020 Nils L. Westhausen
 * https://github.com/breizhn/DTLN-aec/blob/master/LICENSE
 */
let model1: AecModel1 | undefined
let model2: AecModel2 | undefined

export const loadAecModel = async ({
  path,
  units = 128,
  quant
}: {
  path: string
  units?: 128 | 256 | 512
  quant?: 'dynamic' | 'f16'
}) => {
  if (!model1 || !model2) {
    const suffix = quant === undefined ? '' : `_quant_${quant}`
    const [_model1, _model2] = await Promise.all([
      loadTFLiteModel(`${path}dtln_aec_${units}${suffix}_1.tflite`),
      loadTFLiteModel(`${path}dtln_aec_${units}${suffix}_2.tflite`)
    ])
    model1 = _model1 as AecModel1
    model2 = _model2 as AecModel2
  }
}

/**
 * connect mic first and lpb second
 */
export const createDtlnAecProcessorNode = (ctx: BaseAudioContext) => {
  if (!model1 || !model2) {
    throw new Error(
      'loadModel() should be called before calling createDtlnProcessorNode'
    )
  }

  const inputChannelCount = 2
  const outputChannelCount = 1
  const shiftCount = 2

  const node = ctx.createScriptProcessor(
    blockShift * shiftCount,
    inputChannelCount,
    outputChannelCount
  )
  const processes = Array.from({ length: inputChannelCount / 2 }, () =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    createAecProcess(model1!, model2!)
  )

  node.addEventListener('audioprocess', ({ inputBuffer, outputBuffer }) => {
    for (let i = 0; i < shiftCount; i++) {
      const start = i * blockShift
      const end = (i + 1) * blockShift
      for (
        let channel = 0;
        channel < outputBuffer.numberOfChannels;
        channel++
      ) {
        const inputMic = inputBuffer.getChannelData(2 * channel)
        const inputLpb = inputBuffer.getChannelData(2 * channel + 1)
        const output = outputBuffer.getChannelData(channel)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const process = processes[channel]!

        process(
          inputMic.subarray(start, end),
          inputLpb.subarray(start, end),
          output.subarray(start, end)
        )
      }
    }
  })
  return node
}

export const processPCMWithAEC = (micData: Float32Array, speakerData: Float32Array) => {
  console.log('Entered processPCMWithAEC')
  if (!model1 || !model2) {
    throw new Error(
      'loadModel() should be called before calling createDtlnProcessorNode'
    )
  }
  const blockShift = 128;
  const shiftCount = 2;
  const outputData = new Float32Array(micData.length);

  const process2 = createAecProcess(model1, model2);

  for (let i = 0; i < micData.length; i += blockShift * shiftCount) {
    for (let shift = 0; shift < shiftCount; shift++) {
      const start = i + shift * blockShift;
      const end = start + blockShift;
      
      if (end > micData.length) break; // Stop if out of bounds

      const micChunk = micData.subarray(start, end);
      const spkChunk = speakerData.subarray(start, end);
      const outChunk = outputData.subarray(start, end);

      process2(micChunk, spkChunk, outChunk);
    }
  }

  console.log('Exiting processPCMWithAEC')
  return outputData;
};

