'use client';

import { useRef, useState } from 'react';
import { TextArea } from '@heroui/react/textarea';
import { X } from 'lucide-react';
import { AppModal } from '@/components/ui/app-modal';
import { AppInput } from '@/components/ui/app-input';
import { useI18n } from '@/i18n/I18nProvider';

function testCaseMessage(target: string, requirement: string, designs: string[]) {
  return `测试目标地址是${target}
需求地址是${requirement}
蓝湖地址是${designs.join('\n')}
你是一个测试助手，现在我需要你基于这个需求进行分析，输出用于模型进行的需求测试的测试用例，我要你输出的用例是通用的，模型易于理解并执行的，有条理的。
你的输出应该分为2个部分，功能验证和UI验收。
其中，功能验证需要聚焦于以下几点
1.需要整理流程，列出测试该流程需要哪些测试账号，这些账号分别需要什么权限，作为什么角色参与到这个需求业务流程的哪些操作。
2.完整的需求业务流程操作，从开始到结束完成这个需求的完整的过程说明。
3.可能出现的边界情况，会影响这个流程操作的内容。
4.所有操作是否被权限控制住了，包括前端按钮，界面，后端接口等
UI验收需要聚焦于以下内容：
1.界面中元素的样式是否与设计图中的一致
2.表格中的字段是否与设计图一致（目前设计不会在蓝湖中详细画出表格的全部字段，该内容需要去prd中获取）
3.是否可能由于各种边界情况造成的前端界面的扭曲，变形等情况
测试角色，账号及权限的配置流程如下：
https://10.2.211.1/#/plat/role/list，这个是配置角色权限的地方，你可以新建角色，设置角色包括的人员，然后点击列表页中的角色链接进入角色权限配置界面
这是修改账号密码的地方：https://10.2.211.1/manage#/core/user/manage/list/0?size=10&sort=updateTime,desc
你在这个界面进行重置对应账户的密码，创建其他可登录账号，注意，你要修改的密码为Admin123,同时取消勾选：下次登录时必须修改密码。
我要你最终输出的测试用例是以下的格式，以业务需求的流程进行完整的，全面的操作
1.明确此次需求需要哪些测试账号作为什么角色，需要哪些权限，模型基于这些内容如何在测试角色，账号及权限的配置流程中进行操作
2.对于测试。输出下面这个表格
|阶段|测试账号|角色|此次使用的权限（没有或者通用权限填无）|操作界面（包括弹窗等）的描述以及链接|进行操作的内容|该界面的蓝湖设计图链接地址（注意，这个要在全部视图中双击图片进入详细界面）|该操作执行完毕后如何验证|此次操作有没有什么边界情况需要注意|
|---|---|---|---|---|---|---|---|---|
模型需要基于这个表格里面的测试用例来进行每一步的验证测试
注意，你需要完整，详细的考虑到所有的情况，保证输出的测试用例是准确的，合理的。如果有什么不确定的，在生成测试用例之前声明，让用户补充
还有，如果是列表页，你要逐页测试过滤是否正常。
最终输出结果是md文档`;
}

export function BrowserChatTestCaseDialog({ onClose, onSend }: {
  onClose: () => void;
  onSend: (content: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState('');
  const [requirement, setRequirement] = useState('');
  const [designs, setDesigns] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState('');
  async function submit() {
    if (sendingRef.current) return;
    const urls = designs.trim().split(/\s+/).filter(Boolean);
    const validUrl = (value: string) => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
    if (!validUrl(target.trim()) || !validUrl(requirement.trim()) || !urls.length || urls.some((url) => !validUrl(url))) {
      setError(t('请填写有效的测试目标地址、需求地址和蓝湖地址，多个蓝湖地址用换行分隔。'));
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError('');
    try {
      if (await onSend(testCaseMessage(target.trim(), requirement.trim(), urls))) onClose();
      else setError(t('消息未发送，请稍后重试。'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('发送消息失败'));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  return <AppModal ariaLabel={t('生成测试用例')} onClose={onClose} dismissable={!sending} keyboardDismissable={!sending} size="lg" dialogClassName="browser-chat-test-case-dialog">
    <form className="webpilot-modal-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <header className="ui-modal-header">
        <h2 className="ui-modal-title">{t('生成测试用例')}</h2>
        <button aria-label={t('关闭')} className="ui-icon-button ui-modal-close" disabled={sending} onClick={onClose} type="button"><X size={18} /></button>
      </header>
      <div className="ui-modal-body browser-chat-test-case-fields">
        <label className="modal-field">{t('测试目标地址')}<AppInput autoFocus type="url" required value={target} onChange={(event) => setTarget(event.target.value)} disabled={sending} placeholder="https://" /></label>
        <label className="modal-field">{t('需求地址')}<AppInput type="url" required value={requirement} onChange={(event) => setRequirement(event.target.value)} disabled={sending} placeholder="https://" /></label>
        <label className="modal-field">{t('蓝湖地址')}<TextArea required value={designs} onChange={(event) => setDesigns(event.target.value)} disabled={sending} rows={4} placeholder={t('支持多个地址，每行一个')} /></label>
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <footer className="ui-modal-footer">
        <button className="ui-button" disabled={sending} onClick={onClose} type="button">{t('取消')}</button>
        <button className="ui-button ui-button--primary" disabled={sending} type="submit">{sending ? t('发送中…') : t('确认并发送')}</button>
      </footer>
    </form>
  </AppModal>;
}
