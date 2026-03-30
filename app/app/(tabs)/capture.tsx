import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { InfoCard } from '../../src/components/ui/InfoCard';
import { SectionTitle } from '../../src/components/ui/SectionTitle';
import { tokens } from '../../src/design/tokens';
import { extractDraftFromImage } from '../../src/lib/capture-api';
import { useCreateQuestionMutation } from '../../src/queries/questions';
import { useSessionStore } from '../../src/store/session-store';

export default function CaptureScreen() {
  const router = useRouter();
  const session = useSessionStore((state) => state.session);
  const createQuestionMutation = useCreateQuestionMutation();
  const [imageUri, setImageUri] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [imageMimeType, setImageMimeType] = useState('image/jpeg');
  const [subject, setSubject] = useState('英语');
  const [questionText, setQuestionText] = useState('');
  const [knowledgePoint, setKnowledgePoint] = useState('');
  const [ability, setAbility] = useState('');
  const [errorType, setErrorType] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState('');
  const [confidence, setConfidence] = useState(70);
  const [rawAiResponse, setRawAiResponse] = useState('');
  const [normalizedPayload, setNormalizedPayload] = useState<Record<string, unknown> | null>(null);
  const [ocrStatus, setOcrStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [message, setMessage] = useState('');

  const canSubmit = useMemo(() => questionText.trim().length > 0 && knowledgePoint.trim().length > 0, [knowledgePoint, questionText]);

  function applyImageResult(result: ImagePicker.ImagePickerResult) {
    if (result.canceled || result.assets.length === 0) {
      return;
    }
    const asset = result.assets[0];
    setImageUri(asset.uri);
    setImageBase64(asset.base64 || '');
    setImageMimeType(asset.mimeType || 'image/jpeg');
    setMessage('');
    setOcrStatus('idle');
  }

  async function handlePickFromCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage('未获得相机权限，请在系统设置中允许访问相机');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });
    applyImageResult(result);
  }

  async function handlePickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('未获得相册权限，请在系统设置中允许访问相册');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      allowsMultipleSelection: false,
    });
    applyImageResult(result);
  }

  async function handleExtract() {
    if (!imageBase64) {
      setMessage('请先拍照或从相册选择图片');
      return;
    }
    setMessage('');
    setOcrStatus('running');
    try {
      const draft = await extractDraftFromImage(imageBase64, imageMimeType);
      setSubject(draft.subject);
      setQuestionText(draft.questionText);
      setKnowledgePoint(draft.knowledgePoint);
      setAbility(draft.ability);
      setErrorType(draft.errorType);
      setCorrectAnswer(draft.correctAnswer);
      setNote(draft.note);
      setSummary(draft.summary);
      setConfidence(draft.confidence);
      setRawAiResponse(draft.rawContent);
      setNormalizedPayload(draft.normalizedPayload);
      setOcrStatus('done');
    } catch (error) {
      setOcrStatus('idle');
      setMessage(error instanceof Error ? error.message : 'OCR 失败，请稍后重试');
    }
  }

  async function handleSubmit(target: 'review' | 'questions' | 'stay') {
    if (!canSubmit || createQuestionMutation.isPending) {
      return;
    }
    try {
      await createQuestionMutation.mutateAsync({
        subject: subject.trim() || '英语',
        questionText: questionText.trim(),
        knowledgePoint: knowledgePoint.trim(),
        ability: ability.trim() || '规则应用',
        errorType: errorType.trim() || knowledgePoint.trim(),
        correctAnswer: correctAnswer.trim() || undefined,
        note: note.trim() || undefined,
        summary: summary.trim() || undefined,
        imageUrl: imageUri || undefined,
        questionType: 'fill',
        rawAiResponse: rawAiResponse || undefined,
        normalizedPayload,
        confidence,
      });
      setMessage('录题提交成功，已写入真实错题库');
      if (target === 'review') {
        router.push('/review' as never);
        return;
      }
      if (target === 'questions') {
        router.push('/questions' as never);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败，请稍后重试');
    }
  }

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <SectionTitle title="录题链路" subtitle="已接通拍照/相册、OCR整理与 create_question 真提交。" />
      <InfoCard
        title="当前状态"
        description={session ? `当前账号：${session.email}` : '请先登录后再执行录题提交'}
      />
      <View style={styles.row}>
        <Pressable onPress={() => void handlePickFromCamera()} style={styles.actionButton}>
          <Text style={styles.actionLabel}>拍照录题</Text>
        </Pressable>
        <Pressable onPress={() => void handlePickFromLibrary()} style={styles.actionButton}>
          <Text style={styles.actionLabel}>相册导入</Text>
        </Pressable>
      </View>

      {imageUri ? <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="cover" /> : null}

      <Pressable disabled={!imageBase64 || ocrStatus === 'running'} onPress={() => void handleExtract()} style={[styles.extractButton, (!imageBase64 || ocrStatus === 'running') && styles.buttonDisabled]}>
        <Text style={styles.extractLabel}>{ocrStatus === 'running' ? 'OCR 识别中...' : '识别并整理题目'}</Text>
      </Pressable>

      <View style={styles.formCard}>
        <Text style={styles.fieldLabel}>科目</Text>
        <TextInput value={subject} onChangeText={setSubject} style={styles.input} placeholder="例如：英语 / C语言" placeholderTextColor={tokens.colors.text.tertiary} />
        <Text style={styles.fieldLabel}>题干</Text>
        <TextInput value={questionText} onChangeText={setQuestionText} style={[styles.input, styles.multilineInput]} multiline placeholder="OCR结果会自动填充，也可手动修正" placeholderTextColor={tokens.colors.text.tertiary} />
        <Text style={styles.fieldLabel}>知识点</Text>
        <TextInput value={knowledgePoint} onChangeText={setKnowledgePoint} style={styles.input} placeholder="例如：一般过去时" placeholderTextColor={tokens.colors.text.tertiary} />
        <Text style={styles.fieldLabel}>能力</Text>
        <TextInput value={ability} onChangeText={setAbility} style={styles.input} placeholder="例如：规则应用" placeholderTextColor={tokens.colors.text.tertiary} />
        <Text style={styles.fieldLabel}>错因</Text>
        <TextInput value={errorType} onChangeText={setErrorType} style={styles.input} placeholder="例如：时态混淆" placeholderTextColor={tokens.colors.text.tertiary} />
        <Text style={styles.fieldLabel}>答案</Text>
        <TextInput value={correctAnswer} onChangeText={setCorrectAnswer} style={styles.input} placeholder="可选" placeholderTextColor={tokens.colors.text.tertiary} />
        <Text style={styles.fieldLabel}>备注</Text>
        <TextInput value={note} onChangeText={setNote} style={[styles.input, styles.multilineInput]} multiline placeholder="可选" placeholderTextColor={tokens.colors.text.tertiary} />
        <Text style={styles.fieldLabel}>摘要</Text>
        <TextInput value={summary} onChangeText={setSummary} style={styles.input} placeholder="可选" placeholderTextColor={tokens.colors.text.tertiary} />
        <Text style={styles.fieldLabel}>识别置信度（0-100）</Text>
        <TextInput
          value={String(confidence)}
          onChangeText={(value) => setConfidence(Math.max(0, Math.min(100, Number(value) || 0)))}
          style={styles.input}
          keyboardType="number-pad"
          placeholder="70"
          placeholderTextColor={tokens.colors.text.tertiary}
        />
      </View>

      <View style={styles.row}>
        <Pressable disabled={!canSubmit || createQuestionMutation.isPending} onPress={() => void handleSubmit('stay')} style={[styles.submitButton, (!canSubmit || createQuestionMutation.isPending) && styles.buttonDisabled]}>
          <Text style={styles.submitLabel}>{createQuestionMutation.isPending ? '提交中...' : '提交题目'}</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable disabled={!canSubmit || createQuestionMutation.isPending} onPress={() => void handleSubmit('review')} style={[styles.routeButton, (!canSubmit || createQuestionMutation.isPending) && styles.buttonDisabled]}>
          <Text style={styles.routeLabel}>提交后去复习</Text>
        </Pressable>
        <Pressable disabled={!canSubmit || createQuestionMutation.isPending} onPress={() => void handleSubmit('questions')} style={[styles.routeButton, (!canSubmit || createQuestionMutation.isPending) && styles.buttonDisabled]}>
          <Text style={styles.routeLabel}>提交后去错题库</Text>
        </Pressable>
      </View>

      {message ? (
        <InfoCard title="结果" description={message} />
      ) : null}
      <Text style={styles.note}>当前录题流程已从“说明页”切换为可执行闭环：拍照/相册 → OCR整理 → create_question → 跳转复习或错题库。</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: tokens.spacing[5],
    paddingBottom: tokens.spacing[8],
  },
  row: {
    flexDirection: 'row',
    gap: tokens.spacing[3],
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    backgroundColor: tokens.colors.surface.primary,
    paddingVertical: tokens.spacing[3],
  },
  actionLabel: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: tokens.radius.xl,
    backgroundColor: tokens.colors.surface.secondary,
  },
  extractButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.colors.primary.default,
    paddingVertical: tokens.spacing[3],
  },
  extractLabel: {
    color: '#FFFFFF',
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  formCard: {
    gap: tokens.spacing[2],
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.surface.primary,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
  },
  fieldLabel: {
    color: tokens.colors.text.secondary,
    fontSize: tokens.typography.label.s.fontSize,
    fontWeight: '700',
    marginTop: tokens.spacing[2],
  },
  input: {
    minHeight: tokens.layout.touchTargetMin,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.colors.stroke.soft,
    backgroundColor: tokens.colors.surface.primary,
    paddingHorizontal: tokens.spacing[4],
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.body.m.fontSize,
  },
  multilineInput: {
    minHeight: 92,
    textAlignVertical: 'top',
    paddingVertical: tokens.spacing[3],
  },
  submitButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.lg,
    backgroundColor: '#DCFCE7',
    paddingVertical: tokens.spacing[3],
  },
  submitLabel: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.label.m.fontSize,
    fontWeight: '700',
  },
  routeButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.lg,
    backgroundColor: '#EFF6FF',
    paddingVertical: tokens.spacing[3],
  },
  routeLabel: {
    color: tokens.colors.text.primary,
    fontSize: tokens.typography.label.s.fontSize,
    fontWeight: '700',
  },
  note: {
    color: tokens.colors.text.tertiary,
    fontSize: tokens.typography.body.s.fontSize,
    lineHeight: tokens.typography.body.s.lineHeight,
  },
});
