import { Col, Container, Row } from 'react-bootstrap';
import './LoadingOverlay.css';

const LoaderOverlay = ( props:{ text?:string, subtext?:string, hidden?:boolean, spinner?:boolean}) => {
if(!props.hidden){
  return(
            <Container className="loaderOverlay">
                <Row style={{height:'100%'}}>
                    <Col sm={12} style={{alignContent:'center', textAlign:'center', minHeight:'60%'}}>
                        <div className="lds-ring" hidden={props.spinner?false:true}><div></div><div></div><div></div><div></div></div>
                        <h1>{props.text?props.text:''}</h1>
                        <p>{props.subtext?props.subtext:''}</p>
                    </Col>
                </Row>
            </Container>
    )
  }
  else{
    return(<></>);
  }
}

export default LoaderOverlay;