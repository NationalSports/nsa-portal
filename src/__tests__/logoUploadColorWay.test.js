import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GarmentMockCard from '../GarmentMockCard';
jest.mock('../utils', () => ({ fileDisplayName: f => f.name || f.url, _isImgUrl: () => true, _cloudinaryPdfThumb: () => null, openFile: jest.fn() }));
const options=[{id:'white',label:'White ink',colors:'White',url:''},{id:'gold',label:'Gold ink',colors:'Gold',url:''}];
const setup=(ok=true)=>{
 const onUpload=jest.fn().mockResolvedValue(true),onAssign=jest.fn().mockResolvedValue(ok);
 function Fixture(){const [id,setId]=React.useState();return <GarmentMockCard label="Royal shirt" mocks={[]} candidates={[]} logo={{url:'',bg:'#224ddd',needsColorWay:!id,colorWayId:id,colorWays:options,onUpload,onAssign:async choice=>{setId(choice.colorWayId);return onAssign(choice)}}}/>}
 render(<Fixture/>);return {onUpload,onAssign};
};
test('unresolved and merely selected artwork blocks uploads until assignment is saved',()=>{
 const {onUpload}=setup();
 fireEvent.change(screen.getByRole('combobox',{name:'Artwork version'}),{target:{value:'gold'}});
 fireEvent.drop(screen.getByText('Choose and save an artwork version below').closest('.panel-frame'),{dataTransfer:{files:[new File(['png'],'logo.png',{type:'image/png'})]}});
 expect(onUpload).not.toHaveBeenCalled();
 expect(screen.getByRole('alert').textContent).toContain('Save the artwork choice');
 expect(screen.getByRole('button',{name:'Upload logo PNG'}).disabled).toBe(true);
});
test('confirmed assignment enables upload; failed save stays blocked and retryable',async()=>{
 const {onAssign}=setup(false);
 fireEvent.change(screen.getByRole('combobox',{name:'Artwork version'}),{target:{value:'gold'}});
 fireEvent.click(screen.getByRole('button',{name:'Save artwork choice'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('not saved'));
 expect(screen.getByRole('button',{name:'Upload logo PNG'}).disabled).toBe(true);
 onAssign.mockResolvedValue(true);
 fireEvent.click(screen.getByRole('button',{name:'Save artwork choice'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Upload logo PNG'}).disabled).toBe(false));
 expect(onAssign).toHaveBeenLastCalledWith({colorWayId:'gold',allGarments:false});
});
test('bulk scope requires confirmation and can be cancelled without saving',()=>{
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
 try{const {onAssign}=setup();
 fireEvent.change(screen.getByRole('combobox',{name:'Artwork version'}),{target:{value:'gold'}});
 fireEvent.click(screen.getByRole('checkbox',{name:/Same artwork for all/}));
 fireEvent.click(screen.getByRole('button',{name:'Save artwork choice'}));
 expect(confirm).toHaveBeenCalled();expect(onAssign).not.toHaveBeenCalled();
 }finally{confirm.mockRestore()}
});
