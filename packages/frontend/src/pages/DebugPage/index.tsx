import React, {
  useState,
  useReducer,
  useRef,
  useCallback,
  useContext,
  useEffect,
} from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { useRouteMatch, useHistory } from 'react-router-dom';

import 'ace-builds';
import 'ace-builds/webpack-resolver';
import type { Ace } from 'ace-builds';
import AceEditor from 'react-ace';
import type { Viewer } from '@toast-ui/react-editor';

import babelParser from 'prettier/parser-babel';
import prettier from 'prettier/standalone';

import styled from '@cyfm/styled';
import { throttlePromise } from '@cyfm/throttle';

import FullWidthViewer from 'components/FullWidthViewer';
import EditorPage from 'pages/EditorPage';
import Button from 'components/Button';
import Console from 'components/Console';
import { LoginContext } from 'contexts/LoginContext';
import MessageModal from 'components/Modal/MessageModal';
import LoadingModal from 'components/Modal/LoadingModal';

import { useSandbox } from 'hooks/useSandbox';
import { useBlockUnload } from 'hooks/useBlockUnload';
import { debugReducer, modalReducer } from './reducer';
import { VALID_LANGUAGES } from 'pages/WritePage/constant';

import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/theme-twilight';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import {
  LOGIN_VALIDATION_FAIL_MESSAGE,
  PROBLEM_LOAD_FAIL_MESSAGE,
} from './message';

const ViewerWrapper = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  background-color: #2f333c;
  overflow-y: auto;
`;

const EditorWrapper = styled.div`
  flex-basis: 100%;
`;

const ConsoleWrapper = styled.div`
  padding: 20px;
  min-height: 300px;
  background: #24262a;
  color: white;
`;

const ButtonFooter = styled.div`
  display: flex;
  flex-basis: 0;
  justify-content: space-evenly;
  background: #1c1d20;
`;

const getQuery = (qs: string) => {
  let result: object = {};
  qs.replace('?', '')
    .split('&')
    .forEach(pair => {
      const [key, value] = pair.split('=');
      result = Object.assign(result, { [key]: value });
    });
  return result;
};

const DebugPage: React.FC = () => {
  const [debugStates, dispatch] = useReducer(debugReducer, {
    initCode: '',
    content: '',
    code: '',
    category: '',
    testCode: [],
  });
  const [modalStates, modalDispatch] = useReducer(modalReducer, {
    openLoading: false,
    openMessage: false,
  });

  const { isLogin } = useContext(LoginContext);
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState('');

  const history = useHistory();

  const unblockRef = useRef(false);
  useBlockUnload(debugStates, unblockRef, (_, deps) => {
    return deps.initCode !== deps.code;
  });

  const viewerRef: MutableRefObject<Viewer | undefined> = useRef();
  const editorRef: MutableRefObject<(AceEditor & Ace.Editor) | undefined> =
    useRef();

  const match = useRouteMatch<{ id: string }>('/debug/:id');
  const id = match?.params.id;

  const getProblem = useCallback(async () => {
    const query = getQuery(history.location.pathname);

    try {
      const res = await fetch(
        `${process.env.REACT_APP_API_URL}/api/problem/${id}`,
      );

      if (res.status !== 200) {
        setMessage(PROBLEM_LOAD_FAIL_MESSAGE);
        modalDispatch({
          type: 'open',
          payload: { target: 'message' },
        });
      } else {
        const json = await res.json();
        const { content, code, testCode } = json as {
          content: string;
          code: string;
          testCode: string[];
        };
        const prettierCode = prettier.format(code, {
          singleQuote: true,
          semi: true,
          tabWidth: 2,
          trailingComma: 'all',
          arrowParens: 'avoid',
          parser: 'babel',
          plugins: [babelParser],
        });

        dispatch({
          type: 'init',
          payload: {
            code: prettierCode,
            content,
            category: query['category' as keyof typeof query],
            testCode,
          },
        });

        viewerRef.current?.getInstance().setMarkdown(content);
      }
    } catch (err) {
      setMessage(PROBLEM_LOAD_FAIL_MESSAGE);
      modalDispatch({
        type: 'open',
        payload: { target: 'message' },
      });
    }
  }, [history.location.pathname, id]);

  useEffect(() => {
    getProblem();
  }, [getProblem, id]);

  const onChange = useCallback(
    code => dispatch({ type: 'setCode', payload: { code } }),
    [],
  );

  const onLoad = useCallback(
    editor => {
      editorRef.current = editor;
    },
    [editorRef],
  );

  const submit = () => {
    if (!isLogin) {
      setMessage(LOGIN_VALIDATION_FAIL_MESSAGE);
      modalDispatch({
        type: 'open',
        payload: { target: 'message' },
      });
      return;
    }

    unblockRef.current = true;
    history.push('/result', {
      code: (editorRef.current as Ace.Editor).getValue() as string,
      testCode: debugStates.testCode,
      problemId: id,
    });
  };

  const submitPromise = throttlePromise(submit, 3000);

  const onSubmit = useCallback(submitPromise, [
    submitPromise,
    debugStates.testCode,
    history,
    id,
  ]);

  const [sandboxRef, console] = useSandbox({
    setter: setOutput,
    timeout: 3000,
    onLoadStart: () =>
      modalDispatch({ type: 'open', payload: { target: 'loading' } }),
    onLoadEnd: () =>
      modalDispatch({ type: 'close', payload: { target: 'loading' } }),
  });

  const onExecute = useCallback(() => {
    if (!sandboxRef.current) return;
    console.clear();

    const signal = new CustomEvent('exec', { detail: debugStates.code });
    sandboxRef.current.dispatchEvent(signal);
  }, [sandboxRef, console, debugStates.code]);

  const initializeCode = useCallback(() => {
    const editor = editorRef.current as Ace.Editor;
    editor.setValue(debugStates.initCode as string);
    editor.focus();
    editor.clearSelection();

    dispatch({
      type: 'init',
      payload: { ...debugStates, code: debugStates.initCode },
    });
  }, [debugStates]);

  useEffect(() => {
    if (history.location.state) {
      const code =
        (history.location.state as { deps: { code: string } }).deps.code ?? '';
      if (code) {
        dispatch({ type: 'setCode', payload: { code } });
      }
    }
  }, [history]);

  return (
    <EditorPage
      leftPane={
        <>
          <ViewerWrapper>
            <FullWidthViewer
              theme="dark"
              ref={viewerRef as RefObject<FullWidthViewer>}
            />
          </ViewerWrapper>
          <ConsoleWrapper>
            <Console value={output} readOnly />
          </ConsoleWrapper>
        </>
      }
      rightPane={
        <>
          <EditorWrapper>
            <AceEditor
              onLoad={onLoad}
              onChange={onChange}
              mode={
                debugStates.category &&
                VALID_LANGUAGES.includes(debugStates.category)
                  ? debugStates.category
                  : 'javascript'
              }
              width="100%"
              height="100%"
              theme="twilight"
              name="test"
              fontSize={16}
              value={debugStates.code}
              editorProps={{ $blockScrolling: true }}
              setOptions={{
                tabSize: 2,
              }}
            />
          </EditorWrapper>
          <ButtonFooter>
            <Button onClick={initializeCode}>초기화</Button>
            <Button onClick={onExecute}>실행</Button>
            <Button onClick={onSubmit}>제출</Button>
          </ButtonFooter>
          <LoadingModal isOpen={modalStates.openLoading} />
          <MessageModal
            isOpen={modalStates.openMessage}
            setter={modalDispatch}
            target={'message'}
            message={message}
            close={true}
          />
        </>
      }
    />
  );
};

export default DebugPage;
