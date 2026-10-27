import unittest,json,tempfile,pathlib
from study import setup,SRC
from study import usage_from
class UsageTests(unittest.TestCase):
 def test_openai_cache_included_not_added(self):
  raw=b'data: {"model":"deepseek-flash","usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_cache_hit_tokens":80}}\n'
  self.assertEqual(usage_from(raw,False)['input'],100)
 def test_anthropic_merge_not_sum_cumulative_output(self):
  raw=b'data: {"message":{"model":"deepseek-flash","usage":{"input_tokens":20,"cache_read_input_tokens":80,"output_tokens":1}}}\ndata: {"usage":{"output_tokens":10}}\ndata: {"usage":{"output_tokens":20}}\n'
  u=usage_from(raw,True);self.assertEqual(u['input'],100);self.assertEqual(u['output'],20)
 def test_absent_is_unknown(self):self.assertIsNone(usage_from(b'data: [DONE]\n',False))
class DirectoryTests(unittest.TestCase):
 def test_opencode_directory_is_explicit(self):
  with tempfile.TemporaryDirectory() as d:
   args,env=setup('opencode',pathlib.Path(d),12345)
   self.assertIn('--dir',args)
   self.assertEqual(pathlib.Path(args[args.index('--dir')+1]).resolve(),SRC.resolve())
   self.assertEqual(pathlib.Path(env['PWD']).resolve(),SRC.resolve())
if __name__=='__main__':unittest.main()
